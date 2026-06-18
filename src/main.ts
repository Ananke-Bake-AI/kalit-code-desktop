// ============================================================
// kalit-code-desktop — Electron main process
// ============================================================
// Owns the agent (full Node/filesystem/shell access) + conversation
// store, and bridges them to the sandboxed renderer over IPC.

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import { runTurn, checkServer, fetchModels, type AgentConfig } from 'kalit-code-core';

/** App icon (PNG for window/dock; assets/icon.icns is used when packaging). */
const ICON_PNG = path.join(__dirname, '..', 'assets', 'icon.png');

// ─── Persisted config ───────────────────────────────────────

type AppConfig = AgentConfig;

const CONFIG_PATH = () => path.join(app.getPath('userData'), 'config.json');
const CONVS_PATH = () => path.join(app.getPath('userData'), 'conversations.json');

const DEFAULT_CONFIG: AppConfig = {
  serverUrl: process.env.KALIT_SERVER_URL || 'http://localhost:4747',
  token: process.env.KALIT_TOKEN || 'kalit-code',
  model: process.env.KALIT_MODEL || 'ollama/kimi-k2.5:cloud',
  cwd: process.env.KALIT_CWD || os.homedir(),
  permissionMode: 'bypassPermissions',
  contextWindow: Number(process.env.KALIT_CONTEXT_WINDOW || 200_000),
};

let config: AppConfig = { ...DEFAULT_CONFIG };

async function loadConfig(): Promise<void> {
  try {
    config = { ...DEFAULT_CONFIG, ...JSON.parse(await fs.readFile(CONFIG_PATH(), 'utf-8')) };
  } catch { /* first run */ }
}
async function saveConfig(): Promise<void> {
  await fs.mkdir(path.dirname(CONFIG_PATH()), { recursive: true });
  await fs.writeFile(CONFIG_PATH(), JSON.stringify(config, null, 2), 'utf-8');
}

// ─── Conversation store ─────────────────────────────────────

interface StoredMessage { role: 'user' | 'assistant'; content: string; thinking?: string; tools?: string[] }
interface Conversation {
  id: string;
  title: string;
  model: string;
  sessionId?: string;
  contextPercent: number;
  updatedAt: number;
  messages: StoredMessage[];
}

let convs: Conversation[] = [];

async function loadConvs(): Promise<void> {
  try {
    const raw = JSON.parse(await fs.readFile(CONVS_PATH(), 'utf-8'));
    convs = Array.isArray(raw.conversations) ? raw.conversations : [];
  } catch { convs = []; }
}
async function saveConvs(): Promise<void> {
  await fs.mkdir(path.dirname(CONVS_PATH()), { recursive: true });
  await fs.writeFile(CONVS_PATH(), JSON.stringify({ conversations: convs }, null, 2), 'utf-8');
}

let convSeq = 0;
function newId(): string { convSeq += 1; return `c_${app.isReady() ? Date.now() : 0}_${convSeq}`; }

function summary(c: Conversation) {
  return { id: c.id, title: c.title, model: c.model, contextPercent: c.contextPercent, updatedAt: c.updatedAt };
}

// ─── Window ─────────────────────────────────────────────────

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1180, height: 820, minWidth: 760, minHeight: 480,
    backgroundColor: '#0f1115', title: 'kalit-code', icon: ICON_PNG,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// ─── Agent turn state ───────────────────────────────────────

let currentAbort: AbortController | null = null;

// ─── IPC: config ────────────────────────────────────────────

ipcMain.handle('config:get', () => config);
ipcMain.handle('config:set', async (_e, patch: Partial<AppConfig>) => {
  config = { ...config, ...patch };
  await saveConfig();
  return config;
});
ipcMain.handle('models:list', (_e, args: { serverUrl?: string; token?: string } = {}) =>
  fetchModels(args.serverUrl || config.serverUrl, args.token || config.token));
ipcMain.handle('server:health', (_e, args: { serverUrl?: string } = {}) =>
  checkServer(args.serverUrl || config.serverUrl));

// ─── IPC: conversations ─────────────────────────────────────

ipcMain.handle('conv:list', () => [...convs].sort((a, b) => b.updatedAt - a.updatedAt).map(summary));
ipcMain.handle('conv:get', (_e, id: string) => convs.find(c => c.id === id) ?? null);
ipcMain.handle('conv:new', async () => {
  const c: Conversation = { id: newId(), title: 'New chat', model: config.model, contextPercent: 0, updatedAt: Date.now(), messages: [] };
  convs.unshift(c);
  await saveConvs();
  return summary(c);
});
ipcMain.handle('conv:delete', async (_e, id: string) => {
  convs = convs.filter(c => c.id !== id);
  await saveConvs();
  return { ok: true };
});
ipcMain.handle('conv:rename', async (_e, id: string, title: string) => {
  const c = convs.find(x => x.id === id);
  if (c) { c.title = title.slice(0, 80) || c.title; await saveConvs(); }
  return { ok: true };
});
ipcMain.handle('conv:setModel', async (_e, id: string, model: string) => {
  const c = convs.find(x => x.id === id);
  if (c) { c.model = model; await saveConvs(); }
  return { ok: true };
});

ipcMain.handle('chat:abort', () => { currentAbort?.abort(); return { ok: true }; });

ipcMain.handle('chat:send', async (e, id: string, prompt: string) => {
  let c = convs.find(x => x.id === id);
  if (!c) { c = { id: id || newId(), title: 'New chat', model: config.model, contextPercent: 0, updatedAt: Date.now(), messages: [] }; convs.unshift(c); }
  if (c.title === 'New chat') c.title = prompt.slice(0, 48);
  c.messages.push({ role: 'user', content: prompt });
  c.updatedAt = Date.now();
  await saveConvs();

  const abort = new AbortController();
  currentAbort = abort;
  const send = (channel: string, payload: unknown) => { if (!e.sender.isDestroyed()) e.sender.send(channel, payload); };

  let text = '', thinking = '';
  const tools: string[] = [];
  try {
    for await (const ev of runTurn(prompt, { ...config, model: c.model }, { resumeSessionId: c.sessionId, abortController: abort })) {
      if (ev.type === 'text') text += ev.text;
      else if (ev.type === 'thinking') thinking += ev.text;
      else if (ev.type === 'tool') tools.push(ev.name);
      else if (ev.type === 'result') { c.sessionId = ev.sessionId || c.sessionId; c.contextPercent = ev.context?.percent ?? c.contextPercent; }
      send('chat:event', { convId: c.id, ev });
    }
  } catch (err) {
    send('chat:event', { convId: c.id, ev: { type: 'error', message: err instanceof Error ? err.message : String(err) } });
  } finally {
    currentAbort = null;
    c.messages.push({ role: 'assistant', content: text, thinking: thinking || undefined, tools: tools.length ? tools : undefined });
    c.updatedAt = Date.now();
    await saveConvs();
    send('chat:done', { convId: c.id, title: c.title, contextPercent: c.contextPercent });
  }
  return { ok: true };
});

// ─── Lifecycle ──────────────────────────────────────────────

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(ICON_PNG);
  await loadConfig();
  await loadConvs();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

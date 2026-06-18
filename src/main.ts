// ============================================================
// kalit-code-desktop — Electron main process
// ============================================================
// Owns the agent (full Node/filesystem/shell access) and bridges it
// to the sandboxed renderer over IPC. The renderer is pure UI.

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
    const raw = await fs.readFile(CONFIG_PATH(), 'utf-8');
    config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch { /* first run — use defaults */ }
}

async function saveConfig(): Promise<void> {
  await fs.mkdir(path.dirname(CONFIG_PATH()), { recursive: true });
  await fs.writeFile(CONFIG_PATH(), JSON.stringify(config, null, 2), 'utf-8');
}

// ─── Window ─────────────────────────────────────────────────

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 1080,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#0f1115',
    title: 'kalit-code',
    icon: ICON_PNG,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// ─── Agent session state ────────────────────────────────────

let sessionId: string | undefined;
let currentAbort: AbortController | null = null;

// ─── IPC ────────────────────────────────────────────────────

ipcMain.handle('config:get', () => config);

ipcMain.handle('config:set', async (_e, patch: Partial<AppConfig>) => {
  config = { ...config, ...patch };
  await saveConfig();
  return config;
});

ipcMain.handle('models:list', (_e, args: { serverUrl?: string; token?: string } = {}) =>
  fetchModels(args.serverUrl || config.serverUrl, args.token || config.token));

ipcMain.handle('server:health', () => checkServer(config.serverUrl));

ipcMain.handle('chat:reset', () => { sessionId = undefined; return { ok: true }; });

ipcMain.handle('chat:abort', () => { currentAbort?.abort(); return { ok: true }; });

ipcMain.handle('chat:send', async (e, prompt: string) => {
  const abort = new AbortController();
  currentAbort = abort;
  const send = (channel: string, payload: unknown) => {
    if (!e.sender.isDestroyed()) e.sender.send(channel, payload);
  };
  try {
    for await (const ev of runTurn(prompt, config, { resumeSessionId: sessionId, abortController: abort })) {
      if (ev.type === 'result') sessionId = ev.sessionId || sessionId;
      send('chat:event', ev);
    }
  } catch (err) {
    send('chat:event', { type: 'error', message: err instanceof Error ? err.message : String(err) });
  } finally {
    currentAbort = null;
    send('chat:done', { ok: true });
  }
  return { ok: true };
});

// ─── Lifecycle ──────────────────────────────────────────────

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(ICON_PNG);
  await loadConfig();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ============================================================
// kalit-code-desktop — renderer (pure UI, talks to main via window.kalit)
// ============================================================
const k = window.kalit;

const $ = (id) => document.getElementById(id);
const messages = $('messages');
const input = $('input');
const sendBtn = $('sendBtn');
const stopBtn = $('stopBtn');
const modelChip = $('modelChip');
const ctxFill = $('ctxFill');
const ctxLabel = $('ctxLabel');

let cfg = null;
let streaming = false;
let active = null; // { textEl, thinkEl } of the assistant message being built

// ─── helpers ────────────────────────────────────────────────

function clearEmpty() { const e = $('empty'); if (e) e.remove(); }

function addMessage(role) {
  clearEmpty();
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  const r = document.createElement('div');
  r.className = 'role';
  r.textContent = role === 'user' ? 'you' : 'kalit-code';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  wrap.append(r, bubble);
  messages.append(wrap);
  messages.scrollTop = messages.scrollHeight;
  return { wrap, bubble };
}

function scroll() { messages.scrollTop = messages.scrollHeight; }

function setContext(pct) {
  const p = Math.max(0, Math.min(100, pct || 0));
  ctxFill.setAttribute('stroke-dasharray', `${p} ${100 - p}`);
  ctxLabel.textContent = `${p}%`;
  const col = p >= 85 ? 'var(--red)' : p >= 65 ? 'var(--yellow)' : 'var(--accent)';
  ctxFill.style.stroke = col;
}

// ─── chat streaming ─────────────────────────────────────────

k.onEvent((ev) => {
  if (!active) return;
  if (ev.type === 'text') {
    active.textEl.textContent += ev.text;
    scroll();
  } else if (ev.type === 'thinking') {
    if (!active.thinkBody) {
      const d = document.createElement('details');
      d.className = 'think';
      const s = document.createElement('summary');
      s.textContent = '💭 thinking';
      const body = document.createElement('div');
      d.append(s, body);
      active.bubble.insertBefore(d, active.textEl);
      active.thinkBody = body;
    }
    active.thinkBody.textContent += ev.text;
    scroll();
  } else if (ev.type === 'tool') {
    const pill = document.createElement('div');
    pill.className = 'tool';
    pill.textContent = `⚙ ${ev.name}`;
    active.bubble.insertBefore(pill, active.textEl);
    scroll();
  } else if (ev.type === 'result') {
    if (ev.context) setContext(ev.context.percent);
    if (ev.isError && ev.text) {
      const e = document.createElement('div');
      e.className = 'err';
      e.textContent = `✗ ${ev.text}`;
      active.bubble.append(e);
    }
  } else if (ev.type === 'error') {
    const e = document.createElement('div');
    e.className = 'err';
    e.textContent = `✗ ${ev.message}`;
    active.bubble.append(e);
  }
});

k.onDone(() => { streaming = false; active = null; setSending(false); });

function setSending(on) {
  streaming = on;
  sendBtn.hidden = on;
  stopBtn.hidden = !on;
  sendBtn.disabled = on;
}

async function send() {
  const prompt = input.value.trim();
  if (!prompt || streaming) return;
  input.value = '';
  autogrow();
  addMessage('user').bubble.textContent = prompt;
  const a = addMessage('assistant');
  const textEl = document.createElement('div');
  a.bubble.append(textEl);
  active = { bubble: a.bubble, textEl, thinkBody: null };
  setSending(true);
  try { await k.send(prompt); } catch (e) { /* done event handles UI */ }
}

// ─── input behaviour ────────────────────────────────────────

function autogrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 220) + 'px';
}
input.addEventListener('input', autogrow);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
sendBtn.addEventListener('click', send);
stopBtn.addEventListener('click', () => k.abort());

$('resetBtn').addEventListener('click', async () => {
  await k.reset();
  messages.innerHTML = '<div class="empty" id="empty"><h1>kalit-code</h1><p>New conversation.</p></div>';
  setContext(0);
});

// ─── settings ───────────────────────────────────────────────

const settings = $('settings');
$('settingsBtn').addEventListener('click', openSettings);
$('cfgCancel').addEventListener('click', () => settings.hidden = true);
$('cfgSave').addEventListener('click', saveSettings);

async function openSettings() {
  cfg = await k.getConfig();
  $('cfgServerUrl').value = cfg.serverUrl || '';
  $('cfgToken').value = cfg.token || '';
  $('cfgCwd').value = cfg.cwd || '';
  $('cfgPerm').value = cfg.permissionMode || 'bypassPermissions';
  $('cfgCtx').value = cfg.contextWindow || 200000;
  // model dropdown
  const sel = $('cfgModel');
  sel.innerHTML = '';
  const ids = await k.listModels();
  if (ids.length === 0) {
    const o = document.createElement('option');
    o.value = cfg.model; o.textContent = cfg.model + '  (server unreachable)';
    sel.append(o);
  } else {
    for (const id of ids) {
      const o = document.createElement('option');
      o.value = id; o.textContent = id;
      if (id === cfg.model) o.selected = true;
      sel.append(o);
    }
    if (!ids.includes(cfg.model)) {
      const o = document.createElement('option');
      o.value = cfg.model; o.textContent = cfg.model + '  (current)';
      o.selected = true; sel.append(o);
    }
  }
  settings.hidden = false;
}

async function saveSettings() {
  const patch = {
    serverUrl: $('cfgServerUrl').value.trim(),
    token: $('cfgToken').value,
    model: $('cfgModel').value,
    cwd: $('cfgCwd').value.trim(),
    permissionMode: $('cfgPerm').value,
    contextWindow: Number($('cfgCtx').value) || 200000,
  };
  cfg = await k.setConfig(patch);
  settings.hidden = true;
  refreshHeader();
}

// ─── init ───────────────────────────────────────────────────

async function refreshHeader() {
  cfg = await k.getConfig();
  modelChip.textContent = cfg.model || '—';
  const h = await k.health();
  modelChip.title = h.ok ? `server: online · ${cfg.serverUrl}` : `server: UNREACHABLE · ${cfg.serverUrl}`;
  modelChip.style.color = h.ok ? '' : 'var(--red)';
}

setContext(0);
refreshHeader();

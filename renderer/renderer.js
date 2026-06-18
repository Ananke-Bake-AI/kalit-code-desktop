// ============================================================
// kalit-code-desktop — renderer (pure UI, talks to main via window.kalit)
// ============================================================
const k = window.kalit;

const $ = (id) => document.getElementById(id);
const messages = $('messages');
const input = $('input');
const sendBtn = $('sendBtn');
const stopBtn = $('stopBtn');
const ctxFill = $('ctxFill');
const ctxLabel = $('ctxLabel');

let cfg = null;
let streaming = false;
let active = null; // { bubble, textEl, thinkBody } of the assistant message being built

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
  ctxFill.style.stroke = p >= 85 ? 'var(--red)' : p >= 65 ? 'var(--yellow)' : 'var(--accent)';
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
    if (ev.isError && ev.text) appendErr(active.bubble, ev.text);
  } else if (ev.type === 'error') {
    appendErr(active.bubble, ev.message);
  }
});

function appendErr(bubble, msg) {
  const e = document.createElement('div');
  e.className = 'err';
  e.textContent = `✗ ${msg}`;
  bubble.append(e);
}

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
  try { await k.send(prompt); } catch { /* done event handles UI */ }
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

// ─── settings (server + token only) ─────────────────────────

const settings = $('settings');
$('settingsBtn').addEventListener('click', openSettings);
$('cfgCancel').addEventListener('click', () => settings.hidden = true);
$('cfgSave').addEventListener('click', saveSettings);

async function openSettings() {
  cfg = await k.getConfig();
  $('cfgServerUrl').value = cfg.serverUrl || '';
  $('cfgToken').value = cfg.token || '';
  $('cfgHint').textContent = '';
  $('cfgHint').className = 'hint';
  settings.hidden = false;
}

async function saveSettings() {
  const patch = {
    serverUrl: $('cfgServerUrl').value.trim(),
    token: $('cfgToken').value,
  };
  cfg = await k.setConfig(patch);
  // Verify reachability and give immediate feedback.
  const h = await k.health();
  const hint = $('cfgHint');
  if (h.ok) {
    hint.textContent = '✓ server reachable';
    hint.className = 'hint';
    settings.hidden = true;
  } else {
    hint.textContent = '✗ server unreachable — check URL / token';
    hint.className = 'hint err';
  }
}

// ─── init ───────────────────────────────────────────────────

setContext(0);
(async () => { cfg = await k.getConfig(); })();

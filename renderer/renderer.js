// ============================================================
// kalit-code-desktop — renderer
// ============================================================
const k = window.kalit;
const $ = (id) => document.getElementById(id);

const messages = $('messages');
const input = $('input');
const sendBtn = $('sendBtn');
const stopBtn = $('stopBtn');
const ctxFill = $('ctxFill');
const ctxLabel = $('ctxLabel');
const convList = $('convList');
const modelSelect = $('modelSelect');
const srvDot = $('srvDot');

let cfg = null;
let activeId = null;
let streaming = false;
let active = null; // assistant build refs for the in-flight turn

// ─── rendering helpers ──────────────────────────────────────

function setContext(pct) {
  const p = Math.max(0, Math.min(100, pct || 0));
  ctxFill.setAttribute('stroke-dasharray', `${p} ${100 - p}`);
  ctxLabel.textContent = `${p}%`;
  ctxFill.style.stroke = p >= 85 ? 'var(--red)' : p >= 65 ? 'var(--yellow)' : 'var(--accent)';
}
function scroll() { messages.scrollTop = messages.scrollHeight; }
function clearEmpty() { const e = $('empty'); if (e) e.remove(); }

function bubbleEl(role) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;
  const r = document.createElement('div'); r.className = 'role'; r.textContent = role === 'user' ? 'you' : 'kalit-code';
  const bubble = document.createElement('div'); bubble.className = 'bubble';
  wrap.append(r, bubble);
  return { wrap, bubble };
}
function appendErr(bubble, msg) { const e = document.createElement('div'); e.className = 'err'; e.textContent = `✗ ${msg}`; bubble.append(e); }

function renderStored(msg) {
  clearEmpty();
  const { wrap, bubble } = bubbleEl(msg.role);
  if (msg.role === 'assistant') {
    if (msg.thinking) {
      const d = document.createElement('details'); d.className = 'think';
      const s = document.createElement('summary'); s.textContent = '💭 thinking';
      const body = document.createElement('div'); body.textContent = msg.thinking;
      d.append(s, body); bubble.append(d);
    }
    for (const t of msg.tools || []) { const p = document.createElement('div'); p.className = 'tool'; p.textContent = `⚙ ${t}`; bubble.append(p); }
    const tx = document.createElement('div'); tx.textContent = msg.content; bubble.append(tx);
  } else {
    bubble.textContent = msg.content;
  }
  messages.append(wrap);
}

async function loadConversation(id) {
  activeId = id;
  messages.innerHTML = '';
  const conv = id ? await k.getConv(id) : null;
  if (conv) {
    for (const m of conv.messages) renderStored(m);
    setContext(conv.contextPercent || 0);
    if (conv.model) modelSelect.value = conv.model;
    if (conv.messages.length === 0) showEmpty();
  } else {
    showEmpty(); setContext(0);
  }
  scroll();
  highlightActive();
}

function showEmpty() {
  messages.innerHTML = '<div class="empty" id="empty"><h1>kalit-code</h1><p>Ask it to read, edit, and run things.</p></div>';
}

// ─── sidebar ────────────────────────────────────────────────

async function refreshConvList() {
  const list = await k.listConvs();
  convList.innerHTML = '';
  for (const c of list) {
    const row = document.createElement('div');
    row.className = 'conv' + (c.id === activeId ? ' active' : '');
    row.dataset.id = c.id;
    const t = document.createElement('span'); t.className = 'title'; t.textContent = c.title || 'New chat';
    const del = document.createElement('button'); del.className = 'del'; del.textContent = '🗑'; del.title = 'Delete';
    row.append(t, del);
    row.addEventListener('click', (e) => { if (e.target === del) return; loadConversation(c.id); });
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      await k.deleteConv(c.id);
      if (activeId === c.id) { activeId = null; showEmpty(); setContext(0); }
      refreshConvList();
    });
    convList.append(row);
  }
}
function highlightActive() {
  [...convList.children].forEach(el => el.classList.toggle('active', el.dataset.id === activeId));
}

$('newChatBtn').addEventListener('click', async () => {
  const c = await k.newConv();
  activeId = c.id;
  if (cfg?.model) modelSelect.value = cfg.model;
  showEmpty(); setContext(0);
  await refreshConvList();
  input.focus();
});

// ─── streaming ──────────────────────────────────────────────

k.onEvent(({ convId, ev }) => {
  if (convId !== activeId || !active) return;
  if (ev.type === 'text') { active.textEl.textContent += ev.text; scroll(); }
  else if (ev.type === 'thinking') {
    if (!active.thinkBody) {
      const d = document.createElement('details'); d.className = 'think';
      const s = document.createElement('summary'); s.textContent = '💭 thinking';
      const body = document.createElement('div'); d.append(s, body);
      active.bubble.insertBefore(d, active.textEl); active.thinkBody = body;
    }
    active.thinkBody.textContent += ev.text; scroll();
  } else if (ev.type === 'tool') {
    const p = document.createElement('div'); p.className = 'tool'; p.textContent = `⚙ ${ev.name}`;
    active.bubble.insertBefore(p, active.textEl); scroll();
  } else if (ev.type === 'result') {
    if (ev.context) setContext(ev.context.percent);
    if (ev.isError && ev.text) appendErr(active.bubble, ev.text);
  } else if (ev.type === 'error') {
    appendErr(active.bubble, ev.message);
  }
});

k.onDone(({ convId, contextPercent }) => {
  if (convId === activeId) { setContext(contextPercent); }
  streaming = false; active = null; setSending(false);
  refreshConvList();
});

function setSending(on) { streaming = on; sendBtn.hidden = on; stopBtn.hidden = !on; sendBtn.disabled = on; }

async function send() {
  const prompt = input.value.trim();
  if (!prompt || streaming) return;
  if (!activeId) { const c = await k.newConv(); activeId = c.id; await refreshConvList(); }
  input.value = ''; autogrow();
  clearEmpty();
  const u = bubbleEl('user'); u.bubble.textContent = prompt; messages.append(u.wrap);
  const a = bubbleEl('assistant'); const textEl = document.createElement('div'); a.bubble.append(textEl); messages.append(a.wrap);
  active = { bubble: a.bubble, textEl, thinkBody: null };
  scroll();
  setSending(true);
  try { await k.send(activeId, prompt); } catch { /* done handles UI */ }
}

// ─── input ──────────────────────────────────────────────────

function autogrow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 220) + 'px'; }
input.addEventListener('input', autogrow);
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
sendBtn.addEventListener('click', send);
stopBtn.addEventListener('click', () => k.abort());

// ─── model selector (top-left) ──────────────────────────────

async function populateModels(selectEl, serverUrl, token, selected) {
  const ids = await k.listModels(serverUrl, token);
  selectEl.innerHTML = '';
  const opts = ids.length ? ids : (selected ? [selected] : []);
  for (const id of opts) {
    const o = document.createElement('option'); o.value = id; o.textContent = id;
    if (id === selected) o.selected = true;
    selectEl.append(o);
  }
  if (selected && !opts.includes(selected)) {
    const o = document.createElement('option'); o.value = selected; o.textContent = selected + ' (current)'; o.selected = true;
    selectEl.append(o);
  }
  if (!ids.length) {
    const o = document.createElement('option'); o.value = ''; o.textContent = '(server unreachable)'; o.disabled = true;
    selectEl.append(o);
  }
}

modelSelect.addEventListener('mousedown', () => populateModels(modelSelect, cfg?.serverUrl, cfg?.token, modelSelect.value));
modelSelect.addEventListener('change', async () => {
  const model = modelSelect.value; if (!model) return;
  cfg = await k.setConfig({ model });
  if (activeId) await k.setConvModel(activeId, model);
});

// ─── settings (full options) ────────────────────────────────

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
  $('cfgHint').textContent = ''; $('cfgHint').className = 'hint';
  await populateModels($('cfgModel'), cfg.serverUrl, cfg.token, cfg.model);
  // re-fetch model list when the user edits creds
  const refetch = () => populateModels($('cfgModel'), $('cfgServerUrl').value.trim(), $('cfgToken').value, $('cfgModel').value);
  $('cfgServerUrl').onchange = refetch;
  $('cfgToken').onchange = refetch;
  settings.hidden = false;
}

async function saveSettings() {
  const patch = {
    serverUrl: $('cfgServerUrl').value.trim(),
    token: $('cfgToken').value,
    model: $('cfgModel').value || cfg.model,
    cwd: $('cfgCwd').value.trim(),
    permissionMode: $('cfgPerm').value,
    contextWindow: Number($('cfgCtx').value) || 200000,
  };
  cfg = await k.setConfig(patch);
  const hint = $('cfgHint');
  const h = await k.health(cfg.serverUrl);
  refreshHealthDot(h.ok);
  await populateModels(modelSelect, cfg.serverUrl, cfg.token, cfg.model);
  if (h.ok) { hint.textContent = '✓ saved · server reachable'; hint.className = 'hint ok'; settings.hidden = true; }
  else { hint.textContent = '✗ saved, but server unreachable — check URL / token'; hint.className = 'hint err'; }
}

function refreshHealthDot(ok) { srvDot.classList.toggle('ok', !!ok); srvDot.classList.toggle('bad', !ok); }

// ─── init ───────────────────────────────────────────────────

(async () => {
  cfg = await k.getConfig();
  setContext(0);
  await populateModels(modelSelect, cfg.serverUrl, cfg.token, cfg.model);
  const h = await k.health(cfg.serverUrl); refreshHealthDot(h.ok);
  await refreshConvList();
  const list = await k.listConvs();
  if (list.length) await loadConversation(list[0].id);
  else showEmpty();
})();

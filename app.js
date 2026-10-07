'use strict';

// Everything runs in the browser. The only network calls are to the provider
// the user picked, with the key they pasted.

const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    kind: 'openai',
    base: 'https://api.openai.com/v1',
    keyUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-...',
    models: ['gpt-5.5', 'chat-latest', 'gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini'],
  },
  anthropic: {
    name: 'Anthropic',
    kind: 'anthropic',
    base: 'https://api.anthropic.com/v1',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    placeholder: 'sk-ant-...',
    models: ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5-20251001'],
  },
  gemini: {
    name: 'Google Gemini',
    kind: 'gemini',
    base: 'https://generativelanguage.googleapis.com/v1beta',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    placeholder: 'AIza...',
    models: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-3.1-flash-lite'],
  },
  groq: {
    name: 'Groq',
    kind: 'openai',
    base: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    placeholder: 'gsk_...',
    models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant', 'qwen/qwen3-32b'],
  },
  openrouter: {
    name: 'OpenRouter',
    kind: 'openai',
    base: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/keys',
    placeholder: 'sk-or-...',
    models: ['openai/gpt-5-mini', 'anthropic/claude-sonnet-5-5', 'google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct'],
  },
  custom: {
    name: 'Lainnya (OpenAI-compatible)',
    kind: 'openai',
    base: '',
    keyUrl: '',
    placeholder: 'key (boleh kosong buat Ollama)',
    models: [],
    editableBase: true,
  },
};

const STORE = {
  settings: 'zpai.settings',
  thread: 'zpai.thread',
  key: (p) => `zpai.key.${p}`,
};

const $ = (id) => document.getElementById(id);
const el = {
  provider: $('provider'),
  fieldBase: $('field-base'),
  baseUrl: $('baseUrl'),
  apiKey: $('apiKey'),
  eye: $('btn-eye'),
  keyLink: $('key-link'),
  remember: $('remember'),
  model: $('model'),
  modelList: $('model-list'),
  system: $('system'),
  test: $('btn-test'),
  testResult: $('test-result'),
  status: $('top-status'),
  newChat: $('btn-new'),
  railToggle: $('btn-rail'),
  rail: $('rail'),
  thread: $('thread'),
  composer: $('composer'),
  input: $('composer-input'),
  send: $('btn-send'),
  tpl: $('tpl-msg'),
};

let thread = [];
let controller = null;

// ---------- storage ----------

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function loadKey(provider) {
  try {
    return localStorage.getItem(STORE.key(provider)) || sessionStorage.getItem(STORE.key(provider)) || '';
  } catch {
    return '';
  }
}

function saveKey(provider, key, remember) {
  try {
    localStorage.removeItem(STORE.key(provider));
    sessionStorage.removeItem(STORE.key(provider));
    if (!key) return;
    (remember ? localStorage : sessionStorage).setItem(STORE.key(provider), key);
  } catch {}
}

function settings() {
  return {
    provider: el.provider.value,
    baseUrl: el.baseUrl.value.trim(),
    // keys copied from a wrapped terminal or email arrive with line breaks inside
    apiKey: el.apiKey.value.replace(/\s+/g, ''),
    remember: el.remember.checked,
    model: el.model.value.trim(),
    system: el.system.value.trim(),
  };
}

function persistSettings() {
  const s = settings();
  writeJSON(STORE.settings, {
    provider: s.provider,
    baseUrl: s.baseUrl,
    remember: s.remember,
    model: s.model,
    system: s.system,
  });
  saveKey(s.provider, s.apiKey, s.remember);
  updateStatus();
}

// ---------- settings UI ----------

function fillProviders() {
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = p.name;
    el.provider.appendChild(opt);
  }
}

function applyProvider(keepModel) {
  const p = PROVIDERS[el.provider.value];
  el.fieldBase.hidden = !p.editableBase;
  el.apiKey.placeholder = p.placeholder;
  el.apiKey.value = loadKey(el.provider.value);
  el.remember.checked = !!localStorage.getItem(STORE.key(el.provider.value));
  el.keyLink.hidden = !p.keyUrl;
  el.keyLink.href = p.keyUrl || '#';

  el.modelList.replaceChildren();
  for (const m of p.models) {
    const opt = document.createElement('option');
    opt.value = m;
    el.modelList.appendChild(opt);
  }
  if (!keepModel) el.model.value = p.models[0] || '';
  el.testResult.textContent = '';
  el.testResult.className = 'test-result';
}

function restoreSettings() {
  const saved = readJSON(STORE.settings, null);
  if (saved && PROVIDERS[saved.provider]) {
    el.provider.value = saved.provider;
    applyProvider(true);
    el.baseUrl.value = saved.baseUrl || '';
    el.model.value = saved.model || PROVIDERS[saved.provider].models[0] || '';
    el.system.value = saved.system || '';
  } else {
    applyProvider(false);
  }
}

function updateStatus() {
  const s = settings();
  const p = PROVIDERS[s.provider];
  const needsKey = s.provider !== 'custom';
  if (needsKey && !s.apiKey) {
    el.status.textContent = `${p.name}: belum ada key`;
  } else if (!s.model) {
    el.status.textContent = `${p.name}: pilih model dulu`;
  } else {
    el.status.textContent = `${p.name} · ${s.model}`;
  }
}

function ready() {
  const s = settings();
  if (s.provider === 'custom' && !s.baseUrl) return 'Isi base URL dulu di panel kiri.';
  if (s.provider !== 'custom' && !s.apiKey) return 'Tempel API key dulu di panel kiri.';
  if (!s.model) return 'Pilih model dulu di panel kiri.';
  return '';
}

// ---------- request builders ----------

function baseUrl(s) {
  const p = PROVIDERS[s.provider];
  const b = (p.editableBase ? s.baseUrl : p.base).replace(/\/+$/, '');
  return b;
}

function buildRequest(s, messages) {
  const p = PROVIDERS[s.provider];
  const base = baseUrl(s);

  if (p.kind === 'anthropic') {
    return {
      url: `${base}/messages`,
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': s.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: s.model,
          max_tokens: 4096,
          stream: true,
          ...(s.system ? { system: s.system } : {}),
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      },
    };
  }

  if (p.kind === 'gemini') {
    return {
      url: `${base}/models/${encodeURIComponent(s.model)}:streamGenerateContent?alt=sse`,
      init: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': s.apiKey,
        },
        body: JSON.stringify({
          ...(s.system ? { systemInstruction: { parts: [{ text: s.system }] } } : {}),
          contents: messages.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
        }),
      },
    };
  }

  const headers = { 'content-type': 'application/json' };
  if (s.apiKey) headers.authorization = `Bearer ${s.apiKey}`;
  if (s.provider === 'openrouter') headers['x-title'] = 'ZPAi';
  return {
    url: `${base}/chat/completions`,
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: s.model,
        stream: true,
        messages: [
          ...(s.system ? [{ role: 'system', content: s.system }] : []),
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
    },
  };
}

// Pull the text piece out of one SSE chunk, whatever the provider's shape is.
function deltaText(kind, data) {
  if (kind === 'anthropic') {
    if (data.type === 'error') throw new Error(data.error?.message || 'Anthropic error');
    if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') return data.delta.text;
    return '';
  }
  if (kind === 'gemini') {
    if (data.error) throw new Error(data.error.message || 'Gemini error');
    const parts = data.candidates?.[0]?.content?.parts || [];
    return parts.map((x) => x.text || '').join('');
  }
  if (data.error) throw new Error(data.error.message || 'API error');
  return data.choices?.[0]?.delta?.content || '';
}

async function* sseLines(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop();
    for (const line of lines) {
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  if (buf.startsWith('data:')) yield buf.slice(5).trim();
}

async function readError(response) {
  const text = await response.text().catch(() => '');
  let msg = '';
  try {
    const j = JSON.parse(text);
    msg = j.error?.message || j.message || (typeof j.error === 'string' ? j.error : '');
  } catch {}
  if (!msg) msg = text.slice(0, 300) || response.statusText || 'tanpa pesan';
  const hints = {
    401: 'Key salah atau sudah dicabut.',
    403: 'Key ini nggak punya akses ke model itu.',
    404: 'Model atau endpoint nggak ketemu. Cek nama modelnya.',
    429: 'Kena rate limit atau saldo habis.',
  };
  const hint = hints[response.status] ? ` ${hints[response.status]}` : '';
  return `HTTP ${response.status}: ${msg}.${hint}`;
}

function networkError(err) {
  if (err.name === 'AbortError') return null;
  if (err instanceof TypeError) {
    return 'Request nggak sampai ke provider. Bisa karena internet putus, base URL salah, atau provider nolak request langsung dari browser (CORS).';
  }
  return err.message || String(err);
}

// ---------- thread rendering ----------

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`);
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return out;
}

// Small markdown subset: fences, headings, lists, paragraphs. Enough for chat.
function renderMarkdown(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++;
      const cls = fence[1] ? ` class="lang-${escapeHtml(fence[1])}"` : '';
      html.push(`<pre><code${cls}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^\s*$/.test(line)) { i++; continue; }

    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { html.push('<hr>'); i++; continue; }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ''));
      html.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''));
      html.push(`<ol>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ol>`);
      continue;
    }

    const para = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^```/.test(lines[i]) && !/^(#{1,3})\s/.test(lines[i]) && !/^\s*([-*]|\d+[.)])\s+/.test(lines[i])) {
      para.push(lines[i++]);
    }
    html.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }
  return html.join('');
}

function addMessage(role, content, who) {
  const node = el.tpl.content.firstElementChild.cloneNode(true);
  node.classList.add(role);
  node.querySelector('.msg-who').textContent = who;
  const body = node.querySelector('.msg-body');
  if (role === 'user') body.textContent = content;
  else body.innerHTML = renderMarkdown(content);
  if (role === 'assistant') {
    const copy = node.querySelector('.msg-copy');
    copy.hidden = false;
    copy.addEventListener('click', () => copyText(copy, body.dataset.raw ?? content));
  }
  el.thread.appendChild(node);
  scrollToEnd();
  return node;
}

async function copyText(btn, text) {
  try {
    await navigator.clipboard.writeText(text);
    btn.classList.add('copied');
    btn.setAttribute('aria-label', 'Tersalin');
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.setAttribute('aria-label', 'Salin jawaban');
    }, 1500);
  } catch {}
}

function scrollToEnd() {
  el.thread.scrollTop = el.thread.scrollHeight;
}

function renderThread() {
  el.thread.replaceChildren();
  for (const m of thread) {
    const node = addMessage(m.role, m.content, m.role === 'user' ? 'Kamu' : m.who || 'AI');
    if (m.role === 'assistant') node.querySelector('.msg-body').dataset.raw = m.content;
  }
}

// ---------- send / stream ----------

function setStreaming(on) {
  el.composer.classList.toggle('is-streaming', on);
  el.send.setAttribute('aria-label', on ? 'Stop' : 'Kirim');
  el.input.disabled = on;
  el.newChat.disabled = on;
}

async function send(text) {
  const problem = ready();
  if (problem) {
    addMessage('error', problem, 'Belum siap');
    el.rail.classList.add('is-open');
    el.railToggle.setAttribute('aria-expanded', 'true');
    return;
  }

  const s = settings();
  const p = PROVIDERS[s.provider];

  thread.push({ role: 'user', content: text });
  addMessage('user', text, 'Kamu');
  writeJSON(STORE.thread, thread);

  const node = addMessage('assistant', '', s.model);
  const body = node.querySelector('.msg-body');
  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.setAttribute('aria-hidden', 'true');
  body.appendChild(caret);

  // busy regions are skipped by screen readers until the answer settles
  node.setAttribute('aria-busy', 'true');
  controller = new AbortController();
  setStreaming(true);

  let acc = '';
  let paintQueued = false;
  const paint = () => {
    paintQueued = false;
    body.innerHTML = renderMarkdown(acc);
    body.appendChild(caret);
    // stick to the bottom only if the user has not scrolled up
    const nearEnd = el.thread.scrollHeight - el.thread.scrollTop - el.thread.clientHeight < 80;
    if (nearEnd) scrollToEnd();
  };

  let failure = null;
  try {
    const { url, init } = buildRequest(s, thread);
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(await readError(res));

    for await (const data of sseLines(res)) {
      if (data === '[DONE]') break;
      let json;
      try { json = JSON.parse(data); } catch { continue; }
      const piece = deltaText(p.kind, json);
      if (!piece) continue;
      acc += piece;
      if (!paintQueued) {
        paintQueued = true;
        requestAnimationFrame(paint);
      }
    }
  } catch (err) {
    failure = networkError(err);
  }

  caret.remove();
  node.removeAttribute('aria-busy');
  body.innerHTML = renderMarkdown(acc);
  body.dataset.raw = acc;
  setStreaming(false);
  controller = null;

  if (acc) {
    thread.push({ role: 'assistant', content: acc, who: s.model });
  } else {
    // nothing came back: drop the turn and hand the text back for a retry
    node.remove();
    thread.pop();
    el.thread.lastElementChild?.remove();
    el.input.value = text;
    autosize();
  }
  writeJSON(STORE.thread, thread);

  if (failure) addMessage('error', failure, 'Gagal');
  el.input.focus();
}

function stop() {
  if (controller) controller.abort();
}

// ---------- test connection ----------

async function testConnection() {
  const problem = ready();
  if (problem) {
    el.testResult.textContent = problem;
    el.testResult.className = 'test-result bad';
    return;
  }
  const s = settings();
  const p = PROVIDERS[s.provider];
  const base = baseUrl(s);

  let url = `${base}/models`;
  const headers = {};
  if (p.kind === 'anthropic') {
    headers['x-api-key'] = s.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  } else if (p.kind === 'gemini') {
    headers['x-goog-api-key'] = s.apiKey;
  } else if (s.apiKey) {
    headers.authorization = `Bearer ${s.apiKey}`;
  }

  el.test.setAttribute('aria-busy', 'true');
  el.test.textContent = 'Mengecek...';
  el.testResult.textContent = '';
  el.testResult.className = 'test-result';
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(await readError(res));
    el.testResult.textContent = 'Key diterima. Siap dipakai.';
    el.testResult.className = 'test-result ok';
  } catch (err) {
    el.testResult.textContent = networkError(err) || 'Gagal.';
    el.testResult.className = 'test-result bad';
  } finally {
    el.test.removeAttribute('aria-busy');
    el.test.textContent = 'Tes koneksi';
  }
}

// ---------- wiring ----------

function autosize() {
  el.input.style.height = 'auto';
  el.input.style.height = `${Math.min(el.input.scrollHeight, 220)}px`;
}

function init() {
  fillProviders();
  restoreSettings();
  updateStatus();
  thread = readJSON(STORE.thread, []);
  renderThread();

  el.provider.addEventListener('change', () => { applyProvider(false); persistSettings(); });
  for (const f of [el.baseUrl, el.apiKey, el.model, el.system]) {
    f.addEventListener('input', persistSettings);
  }
  el.apiKey.addEventListener('paste', () => {
    setTimeout(() => {
      const clean = el.apiKey.value.replace(/\s+/g, '');
      if (clean !== el.apiKey.value) { el.apiKey.value = clean; persistSettings(); }
    }, 0);
  });
  el.remember.addEventListener('change', persistSettings);

  el.eye.addEventListener('click', () => {
    const show = el.apiKey.type === 'password';
    el.apiKey.type = show ? 'text' : 'password';
    el.eye.setAttribute('aria-pressed', String(show));
    el.eye.setAttribute('aria-label', show ? 'Sembunyikan key' : 'Tampilkan key');
  });

  el.test.addEventListener('click', testConnection);

  el.newChat.addEventListener('click', () => {
    thread = [];
    writeJSON(STORE.thread, thread);
    el.thread.replaceChildren();
    el.input.focus();
  });

  el.railToggle.addEventListener('click', () => {
    const open = el.rail.classList.toggle('is-open');
    el.railToggle.setAttribute('aria-expanded', String(open));
    if (open) el.provider.focus();
  });

  el.composer.addEventListener('submit', (e) => {
    e.preventDefault();
    if (controller) { stop(); return; }
    const text = el.input.value.trim();
    if (!text) return;
    el.input.value = '';
    autosize();
    send(text);
  });

  el.input.addEventListener('input', autosize);
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      el.composer.requestSubmit();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (controller) stop();
      else if (el.rail.classList.contains('is-open')) {
        el.rail.classList.remove('is-open');
        el.railToggle.setAttribute('aria-expanded', 'false');
        el.railToggle.focus();
      }
    }
  });

  // leaving the rail open while chatting on a phone hides the thread; close it on send
  el.composer.addEventListener('submit', () => {
    if (window.matchMedia('(max-width: 820px)').matches) {
      el.rail.classList.remove('is-open');
      el.railToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

init();

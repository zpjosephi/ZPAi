'use strict';

// UI glue. Everything runs in the browser; the only network calls are to the
// provider the user picked, with the key they pasted.

(function () {
  const { providers, store, markdown } = ZP;
  const PROVIDERS = providers.list;

  const CUSTOM_MODEL = '__custom';
  const STALL_MS = 60_000;
  const UNDO_MS = 7_000;
  const SETTINGS_DRAWER = window.matchMedia('(max-width: 1179px)');
  const HISTORY_DRAWER = window.matchMedia('(max-width: 759px)');

  const $ = (id) => document.getElementById(id);
  const el = {
    app: $('app'),
    status: $('top-status'),
    themeBtn: $('btn-theme'),
    themeIcon: $('theme-icon'),
    historyBtn: $('btn-history'),
    settingsBtn: $('btn-settings'),
    history: $('history'),
    historyList: $('history-list'),
    historyEmpty: $('history-empty'),
    search: $('history-search'),
    newChat: $('btn-new'),
    chat: $('chat'),
    thread: $('thread'),
    empty: $('empty'),
    linkSettings: $('link-settings'),
    jump: $('btn-jump'),
    composer: $('composer'),
    input: $('composer-input'),
    send: $('btn-send'),
    hint: $('composer-hint'),
    editBanner: $('edit-banner'),
    editCancel: $('btn-edit-cancel'),
    settings: $('settings'),
    provider: $('provider'),
    fieldBase: $('field-base'),
    baseUrl: $('baseUrl'),
    apiKey: $('apiKey'),
    eye: $('btn-eye'),
    eyeIcon: $('eye-icon'),
    keyLink: $('key-link'),
    remember: $('remember'),
    modelWrap: $('model').parentElement,
    model: $('model'),
    modelCustom: $('model-custom'),
    system: $('system'),
    matchTone: $('match-tone'),
    showUsage: $('show-usage'),
    test: $('btn-test'),
    testResult: $('test-result'),
    exportBtn: $('btn-export'),
    importBtn: $('btn-import'),
    importFile: $('import-file'),
    clearBtn: $('btn-clear'),
    backdrop: $('backdrop'),
    toast: $('toast'),
    toastText: $('toast-text'),
    toastAction: $('toast-action'),
    tplMsg: $('tpl-msg'),
    tplItem: $('tpl-chat-item'),
  };

  let chat = null;          // the conversation on screen (unsaved until it has a message)
  let controller = null;    // AbortController for the reply in flight
  let editing = -1;         // index of the user message being edited, or -1
  let openDrawerName = null;
  let drawerReturnFocus = null;
  let pendingUndo = null;   // { finalize } for the toast with an undo button
  let toastTimer = null;
  let hintTimer = null;

  const fmtInt = new Intl.NumberFormat('id-ID');
  const fmtTime = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });
  const fmtDate = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' });
  const fmtFull = new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

  // ---------- settings ----------

  function fillProviders() {
    for (const [id, p] of Object.entries(PROVIDERS)) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = p.name;
      el.provider.appendChild(opt);
    }
  }

  function currentModel() {
    if (el.modelWrap.hidden || el.model.value === CUSTOM_MODEL) return el.modelCustom.value.trim();
    return el.model.value;
  }

  function settings() {
    return {
      provider: el.provider.value,
      baseUrl: el.baseUrl.value.trim(),
      // keys copied from a wrapped terminal or email arrive with line breaks inside
      apiKey: el.apiKey.value.replace(/\s+/g, ''),
      remember: el.remember.checked,
      model: currentModel(),
      system: el.system.value.trim(),
      matchTone: el.matchTone.checked,
      showUsage: el.showUsage.checked,
    };
  }

  function persistSettings() {
    const s = settings();
    store.settings.set({
      provider: s.provider,
      baseUrl: s.baseUrl,
      remember: s.remember,
      model: s.model,
      system: s.system,
      matchTone: s.matchTone,
      showUsage: s.showUsage,
    });
    store.keys.save(s.provider, s.apiKey, s.remember);
    updateStatus();
  }

  function fillModels(p, selected) {
    el.model.replaceChildren();
    for (const m of p.models) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      el.model.appendChild(opt);
    }
    const other = document.createElement('option');
    other.value = CUSTOM_MODEL;
    other.textContent = 'Model lain...';
    el.model.appendChild(other);

    el.modelWrap.hidden = p.models.length === 0;
    if (p.models.length === 0) {
      el.modelCustom.hidden = false;
      el.modelCustom.value = selected || '';
      return;
    }
    if (selected && p.models.includes(selected)) {
      el.model.value = selected;
      el.modelCustom.hidden = true;
      el.modelCustom.value = '';
    } else if (selected) {
      el.model.value = CUSTOM_MODEL;
      el.modelCustom.hidden = false;
      el.modelCustom.value = selected;
    } else {
      el.model.value = p.models[0];
      el.modelCustom.hidden = true;
      el.modelCustom.value = '';
    }
  }

  function applyProvider(selectedModel) {
    const id = el.provider.value;
    const p = PROVIDERS[id];
    el.fieldBase.hidden = !p.editableBase;
    el.apiKey.placeholder = p.placeholder;
    el.apiKey.value = store.keys.load(id);
    el.remember.checked = store.keys.remembered(id);
    el.keyLink.hidden = !p.keyUrl;
    el.keyLink.href = p.keyUrl || '#';
    fillModels(p, selectedModel);
    setTestResult('', '');
  }

  function restoreSettings() {
    const saved = store.settings.get();
    if (saved.provider && PROVIDERS[saved.provider]) {
      el.provider.value = saved.provider;
      applyProvider(saved.model || '');
      el.baseUrl.value = saved.baseUrl || '';
      el.system.value = saved.system || '';
      el.matchTone.checked = !!saved.matchTone;
      el.showUsage.checked = saved.showUsage !== false;
    } else {
      applyProvider('');
      el.showUsage.checked = true;
    }
    applyTheme(saved.theme || 'system');
  }

  function updateStatus() {
    const s = settings();
    const p = PROVIDERS[s.provider];
    if (!p.optionalKey && !s.apiKey) {
      el.status.textContent = `${p.name}: belum ada key`;
    } else if (!s.model) {
      el.status.textContent = `${p.name}: pilih model dulu`;
    } else {
      el.status.textContent = `${p.name} · ${s.model}`;
    }
  }

  function ready() {
    const s = settings();
    const p = PROVIDERS[s.provider];
    if (p.editableBase && !s.baseUrl) return { msg: 'Isi base URL dulu di Pengaturan.', field: el.baseUrl };
    if (!p.optionalKey && !s.apiKey) return { msg: 'Tempel API key dulu di Pengaturan.', field: el.apiKey };
    if (!s.model) return { msg: 'Pilih model dulu di Pengaturan.', field: el.modelWrap.hidden ? el.modelCustom : el.model };
    return null;
  }

  function setTestResult(text, state) {
    el.testResult.textContent = text;
    el.testResult.className = state ? `test-result ${state}` : 'test-result';
  }

  // ---------- theme ----------

  const THEMES = ['system', 'light', 'dark'];
  const THEME_LABEL = { system: 'ikut sistem', light: 'terang', dark: 'gelap' };
  const THEME_ICON = { system: '#i-monitor', light: '#i-sun', dark: '#i-moon' };
  let theme = 'system';

  function applyTheme(next) {
    theme = THEMES.includes(next) ? next : 'system';
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    el.themeIcon.setAttribute('href', THEME_ICON[theme]);
    el.themeBtn.setAttribute('aria-label', `Tema: ${THEME_LABEL[theme]}`);
  }

  // per-component color transitions would make buttons lag behind the page
  // for a frame or two, so they are paused while the whole theme flips
  function cycleTheme() {
    const root = document.documentElement;
    root.classList.add('no-transitions');
    applyTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]);
    store.settings.set({ theme });
    toast(`Tema ${THEME_LABEL[theme]}`);
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('no-transitions')));
  }

  // ---------- drawers (history on phones, settings below desktop width) ----------

  function isDrawer(name) {
    return name === 'history' ? HISTORY_DRAWER.matches : SETTINGS_DRAWER.matches;
  }

  function panelFor(name) { return name === 'history' ? el.history : el.settings; }
  function toggleFor(name) { return name === 'history' ? el.historyBtn : el.settingsBtn; }

  function openDrawer(name) {
    if (!isDrawer(name)) { panelFor(name).querySelector('input, select, textarea, button:not(.drawer-close)')?.focus(); return; }
    if (openDrawerName && openDrawerName !== name) closeDrawer(false);
    openDrawerName = name;
    drawerReturnFocus = document.activeElement;
    const panel = panelFor(name);
    panel.classList.add('is-open');
    el.backdrop.hidden = false;
    toggleFor(name).setAttribute('aria-expanded', 'true');
    el.chat.inert = true;
    panelFor(name === 'history' ? 'settings' : 'history').inert = true;
    panel.querySelector('input, select, textarea, button:not(.drawer-close)')?.focus();
  }

  function closeDrawer(restoreFocus = true) {
    if (!openDrawerName) return;
    const name = openDrawerName;
    openDrawerName = null;
    panelFor(name).classList.remove('is-open');
    el.backdrop.hidden = true;
    toggleFor(name).setAttribute('aria-expanded', 'false');
    el.chat.inert = false;
    el.history.inert = false;
    el.settings.inert = false;
    if (restoreFocus) (drawerReturnFocus || toggleFor(name)).focus?.();
    drawerReturnFocus = null;
  }

  function toggleDrawer(name) {
    if (openDrawerName === name) closeDrawer();
    else openDrawer(name);
  }

  // A panel that stops being a drawer (window grew) must not stay in drawer state.
  function syncDrawers() {
    if (openDrawerName && !isDrawer(openDrawerName)) closeDrawer(false);
  }

  // ---------- toast ----------

  function toast(text, opts = {}) {
    if (pendingUndo) { pendingUndo.finalize(); pendingUndo = null; }
    clearTimeout(toastTimer);
    el.toastText.textContent = text;
    if (opts.action) {
      el.toastAction.textContent = opts.action;
      el.toastAction.hidden = false;
      el.toastAction.onclick = () => { pendingUndo = null; hideToast(); opts.onAction(); };
      pendingUndo = { finalize: opts.onExpire || (() => {}) };
    } else {
      el.toastAction.hidden = true;
      el.toastAction.onclick = null;
    }
    el.toast.hidden = false;
    toastTimer = setTimeout(() => {
      if (pendingUndo) { pendingUndo.finalize(); pendingUndo = null; }
      hideToast();
    }, opts.duration || (opts.action ? UNDO_MS : 2_600));
  }

  function hideToast() {
    clearTimeout(toastTimer);
    el.toast.hidden = true;
  }

  // ---------- history list ----------

  function dayDiff(ts) {
    const a = new Date(ts); a.setHours(0, 0, 0, 0);
    const b = new Date(); b.setHours(0, 0, 0, 0);
    return Math.round((b - a) / 86_400_000);
  }

  function groupLabel(ts) {
    const d = dayDiff(ts);
    if (d <= 0) return 'Hari ini';
    if (d === 1) return 'Kemarin';
    if (d < 7) return '7 hari terakhir';
    if (d < 30) return '30 hari terakhir';
    return 'Lebih lama';
  }

  function relTime(ts) {
    const diff = Date.now() - ts;
    const min = Math.round(diff / 60_000);
    if (min < 1) return 'baru saja';
    if (min < 60) return `${min} mnt lalu`;
    const h = Math.round(min / 60);
    if (h < 24 && dayDiff(ts) === 0) return `${h} jam lalu`;
    if (dayDiff(ts) === 1) return 'kemarin';
    return fmtDate.format(ts);
  }

  function renderHistory() {
    const q = el.search.value.trim().toLowerCase();
    const all = store.chats.index();
    const list = q
      ? all.filter((e) => e.title.toLowerCase().includes(q) || (e.preview || '').toLowerCase().includes(q))
      : all;

    el.historyList.replaceChildren();
    el.historyEmpty.hidden = list.length > 0;
    el.historyEmpty.textContent = all.length === 0
      ? 'Belum ada obrolan tersimpan. Pesan pertama kamu bakal muncul di sini.'
      : 'Nggak ada obrolan yang cocok.';
    if (!list.length) return;

    let group = null;
    let ul = null;
    for (const e of list) {
      const g = groupLabel(e.updatedAt);
      if (g !== group) {
        group = g;
        const section = document.createElement('section');
        section.className = 'history-group';
        const head = document.createElement('h3');
        head.className = 'history-group-title';
        head.textContent = g;
        ul = document.createElement('ul');
        ul.className = 'chat-items';
        section.append(head, ul);
        el.historyList.appendChild(section);
      }
      const li = document.createElement('li');
      li.appendChild(chatItem(e));
      ul.appendChild(li);
    }
  }

  function chatItem(e) {
    const node = el.tplItem.content.firstElementChild.cloneNode(true);
    node.dataset.id = e.id;
    const open = node.querySelector('.chat-open');
    const title = node.querySelector('.chat-title');
    const meta = node.querySelector('.chat-meta');
    title.textContent = e.title;
    meta.textContent = `${e.model || PROVIDERS[e.provider]?.name || ''} · ${relTime(e.updatedAt)}`;
    open.title = e.title;
    if (chat && chat.id === e.id) {
      node.classList.add('is-active');
      open.setAttribute('aria-current', 'page');
    }
    node.querySelector('.chat-rename').setAttribute('aria-label', `Ganti nama "${e.title}"`);
    node.querySelector('.chat-delete').setAttribute('aria-label', `Hapus "${e.title}"`);

    open.addEventListener('click', () => { openChat(e.id); if (isDrawer('history')) closeDrawer(false); });
    node.querySelector('.chat-rename').addEventListener('click', () => startRename(node, e));
    node.querySelector('.chat-delete').addEventListener('click', () => deleteChat(e.id));
    return node;
  }

  function startRename(node, e) {
    const open = node.querySelector('.chat-open');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'chat-rename-input';
    input.value = e.title;
    input.maxLength = 96;
    input.setAttribute('aria-label', 'Nama obrolan');
    node.classList.add('is-renaming');
    open.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save && input.value.trim() && input.value.trim() !== e.title) {
        store.chats.rename(e.id, input.value);
        if (chat && chat.id === e.id) { chat.title = input.value.trim(); chat.titleCustom = true; }
      }
      renderHistory();
      el.historyList.querySelector(`[data-id="${e.id}"] .chat-open`)?.focus();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
      else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  function deleteChat(id) {
    const snapshot = store.chats.get(id);
    if (!snapshot) return;
    store.chats.delete(id);
    const wasActive = chat && chat.id === id;
    if (wasActive) startNew({ silent: true });
    renderHistory();
    toast(`"${snapshot.title}" dihapus.`, {
      action: 'Urungkan',
      onAction: () => {
        store.chats.restore(snapshot);
        renderHistory();
        if (wasActive) openChat(snapshot.id);
      },
    });
  }

  function clearAll() {
    const snapshot = store.exportAll().chats;
    if (!snapshot.length) { toast('Belum ada obrolan yang bisa dihapus.'); return; }
    store.chats.clearAll();
    startNew({ silent: true });
    renderHistory();
    toast(`${snapshot.length} obrolan dihapus.`, {
      action: 'Urungkan',
      onAction: () => {
        for (const c of snapshot) store.chats.restore(c);
        renderHistory();
      },
    });
  }

  // ---------- chat state ----------

  function startNew({ silent } = {}) {
    if (chat && !chat.messages.length) {
      if (!silent) el.input.focus();
      return;
    }
    cancelEdit();
    const s = settings();
    chat = store.chats.create({ provider: s.provider, model: s.model });
    store.chats.setActive(null);
    renderThread();
    renderHistory();
    if (!silent) {
      el.input.focus();
      if (isDrawer('history')) closeDrawer(false);
    }
  }

  function openChat(id) {
    const next = store.chats.get(id);
    if (!next) { toast('Obrolan itu sudah nggak ada.'); renderHistory(); return; }
    cancelEdit();
    chat = next;
    store.chats.setActive(id);
    renderThread();
    renderHistory();
  }

  function saveChat(c) {
    if (!store.chats.save(c)) return;
    if (c === chat) store.chats.setActive(c.id);
  }

  // ---------- thread rendering ----------

  function fmtUsage(u) {
    if (!u || (u.input == null && u.output == null)) return '';
    const parts = [];
    if (u.input != null) parts.push(`${fmtInt.format(u.input)} masuk`);
    if (u.output != null) parts.push(`${fmtInt.format(u.output)} keluar`);
    return parts.join(' · ');
  }

  function iconButton(icon, label, cls, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn-icon ${cls || ''}`.trim();
    b.setAttribute('aria-label', label);
    b.title = label;
    b.innerHTML = `<svg aria-hidden="true" width="18" height="18"><use href="${icon}"/></svg>`;
    b.addEventListener('click', onClick);
    return b;
  }

  function notice(text, actionLabel, onAction) {
    const wrap = document.createElement('div');
    wrap.className = 'msg-notice';
    const span = document.createElement('span');
    span.textContent = text;
    wrap.appendChild(span);
    if (actionLabel) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm';
      b.textContent = actionLabel;
      b.addEventListener('click', onAction);
      wrap.appendChild(b);
    }
    return wrap;
  }

  function stopNotice(m, isLast) {
    if (m.stop === 'length') return notice('Jawaban berhenti di batas token.', isLast ? 'Lanjutkan' : '', continueReply);
    if (m.stop === 'refusal') return notice(`Model menolak melanjutkan${m.stopDetail ? ` (${m.stopDetail})` : ''}.`);
    if (m.stop === 'filter') return notice(`Dihentikan filter konten provider${m.stopDetail ? ` (${m.stopDetail})` : ''}.`);
    if (m.stop === 'aborted') return notice('Dihentikan.');
    return null;
  }

  function addMessage(m, { index, total } = {}) {
    const node = el.tplMsg.content.firstElementChild.cloneNode(true);
    node.classList.add(m.role);
    const who = node.querySelector('.msg-who');
    const time = node.querySelector('.msg-time');
    const body = node.querySelector('.msg-body');
    const usage = node.querySelector('.msg-usage');
    const actions = node.querySelector('.msg-actions');

    who.textContent = m.role === 'user' ? 'Kamu' : (m.model || chat?.model || 'AI');
    if (m.at) {
      time.textContent = fmtTime.format(m.at);
      time.title = fmtFull.format(m.at);
      time.dateTime = new Date(m.at).toISOString();
    }

    if (m.role === 'user') body.textContent = m.content;
    else body.innerHTML = markdown.render(m.content);

    const isLast = index != null && index === total - 1;
    const streaming = !!controller;

    if (m.role === 'assistant') {
      if (el.showUsage.checked) usage.textContent = fmtUsage(m.usage);
      actions.appendChild(iconButton('#i-copy', 'Salin jawaban', 'msg-copy', (ev) => copyText(ev.currentTarget, m.content)));
      if (isLast && !streaming) actions.appendChild(iconButton('#i-refresh', 'Ulangi jawaban', '', regenerate));
      const n = stopNotice(m, isLast && !streaming);
      if (n) node.querySelector('.msg-foot').before(n);
    } else {
      actions.appendChild(iconButton('#i-copy', 'Salin pesan', 'msg-copy', (ev) => copyText(ev.currentTarget, m.content)));
      const lastUser = index != null && chat && chat.messages.slice(index + 1).every((x) => x.role !== 'user');
      if (lastUser && !streaming) actions.appendChild(iconButton('#i-pencil', 'Edit pesan', '', () => editMessage(index)));
    }

    el.thread.appendChild(node);
    return node;
  }

  function addError(text, { retry } = {}) {
    const node = el.tplMsg.content.firstElementChild.cloneNode(true);
    node.classList.add('error');
    node.querySelector('.msg-who').textContent = 'Gagal';
    node.querySelector('.msg-body').textContent = text;
    node.querySelector('.msg-time').remove();
    const actions = node.querySelector('.msg-actions');
    if (retry) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm';
      b.textContent = 'Coba lagi';
      b.addEventListener('click', () => { node.remove(); retry(); });
      actions.appendChild(b);
    }
    el.thread.appendChild(node);
    el.empty.hidden = true;
    scrollToEnd();
    return node;
  }

  async function copyText(btn, text) {
    try {
      await navigator.clipboard.writeText(text);
      const use = btn.querySelector('use');
      use.setAttribute('href', '#i-check');
      btn.classList.add('copied');
      btn.setAttribute('aria-label', 'Tersalin');
      setTimeout(() => {
        use.setAttribute('href', '#i-copy');
        btn.classList.remove('copied');
        btn.setAttribute('aria-label', 'Salin');
      }, 1500);
    } catch {
      toast('Clipboard nggak bisa diakses. Blok teksnya manual aja.');
    }
  }

  function renderThread() {
    el.thread.replaceChildren();
    if (chat) {
      const total = chat.messages.length;
      chat.messages.forEach((m, i) => addMessage(m, { index: i, total }));
    }
    el.empty.hidden = !!(chat && chat.messages.length);
    scrollToEnd();
    updateJump();
  }

  function nearEnd() {
    return el.thread.scrollHeight - el.thread.scrollTop - el.thread.clientHeight < 120;
  }

  // instant on purpose: opening a chat or painting a stream must not animate
  function scrollToEnd() {
    el.thread.scrollTo({ top: el.thread.scrollHeight, behavior: 'instant' });
  }

  function updateJump() {
    el.jump.hidden = !el.thread.children.length || nearEnd();
  }

  // ---------- compose / edit ----------

  function autosize() {
    el.input.style.height = 'auto';
    el.input.style.height = `${Math.min(el.input.scrollHeight, 220)}px`;
  }

  function flashHint(text) {
    clearTimeout(hintTimer);
    el.hint.textContent = text;
    el.hint.classList.add('is-flash');
    hintTimer = setTimeout(() => {
      el.hint.textContent = 'Enter kirim, Shift+Enter baris baru, Esc stop.';
      el.hint.classList.remove('is-flash');
    }, 3000);
  }

  function editMessage(index) {
    if (!chat || controller) return;
    editing = index;
    el.input.value = chat.messages[index].content;
    el.editBanner.hidden = false;
    autosize();
    el.input.focus();
    el.input.setSelectionRange(el.input.value.length, el.input.value.length);
  }

  function cancelEdit() {
    if (editing < 0) return;
    editing = -1;
    el.editBanner.hidden = true;
    el.input.value = '';
    autosize();
  }

  // ---------- send / stream ----------

  function setStreaming(on) {
    el.composer.classList.toggle('is-streaming', on);
    el.send.setAttribute('aria-label', on ? 'Stop' : 'Kirim');
    el.newChat.disabled = on;
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
      400: 'Cek nama model dan isi permintaan.',
      401: 'Key salah atau sudah dicabut.',
      402: 'Saldo atau kredit di provider habis.',
      403: 'Key ini nggak punya akses ke model itu.',
      404: 'Model atau endpoint nggak ketemu. Cek nama modelnya.',
      429: 'Kena rate limit atau kuota habis. Tunggu sebentar lalu coba lagi.',
      500: 'Provider lagi bermasalah. Coba lagi beberapa saat.',
      529: 'Provider lagi kelebihan beban. Coba lagi beberapa saat.',
    };
    const hint = hints[response.status] ? ` ${hints[response.status]}` : '';
    return `HTTP ${response.status}: ${msg}.${hint}`;
  }

  function describeFailure(err) {
    if (err.name === 'AbortError') return err.message === 'stall' ? `Provider nggak ngirim apa-apa selama ${STALL_MS / 1000} detik. Koneksi diputus.` : null;
    if (err instanceof TypeError) {
      return 'Request nggak sampai ke provider. Bisa karena internet putus, base URL salah, atau provider nolak request langsung dari browser (CORS).';
    }
    return err.message || String(err);
  }

  async function* sseEvents(response, onChunk) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let dataLines = [];
    const flush = function* () {
      if (dataLines.length) { yield dataLines.join('\n'); dataLines = []; }
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      onChunk();
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) {
        if (line === '') { yield* flush(); continue; }
        if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (buf.startsWith('data:')) dataLines.push(buf.slice(5).replace(/^ /, ''));
    yield* flush();
  }

  async function send(text) {
    const problem = ready();
    if (problem) {
      addError(problem.msg);
      openDrawer('settings');
      problem.field.focus();
      return;
    }
    if (controller) return;

    const s = settings();
    if (!chat) chat = store.chats.create({ provider: s.provider, model: s.model });

    if (editing >= 0) {
      chat.messages = chat.messages.slice(0, editing);
      editing = -1;
      el.editBanner.hidden = true;
    }

    chat.messages.push({ role: 'user', content: text, at: Date.now() });
    chat.provider = s.provider;
    chat.model = s.model;
    saveChat(chat);
    renderThread();
    renderHistory();
    await stream();
  }

  async function stream() {
    if (controller || !chat || !chat.messages.length) return;
    const s = settings();
    const p = PROVIDERS[s.provider];
    // the reply belongs to this chat even if the user opens another one meanwhile
    const target = chat;

    const node = addMessage({ role: 'assistant', content: '', model: s.model, at: Date.now() });
    const body = node.querySelector('.msg-body');
    const caret = document.createElement('span');
    caret.className = 'caret';
    caret.setAttribute('aria-hidden', 'true');
    body.appendChild(caret);
    // busy regions are skipped by screen readers until the answer settles
    node.setAttribute('aria-busy', 'true');
    scrollToEnd();

    controller = new AbortController();
    setStreaming(true);

    let stallTimer = null;
    const armStall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => controller?.abort(new DOMException('stall', 'AbortError')), STALL_MS);
    };

    let acc = '';
    let usage = null;
    let stop = null;
    let stopDetail = '';
    let paintQueued = false;
    const paint = () => {
      paintQueued = false;
      if (chat !== target) return;
      const stick = nearEnd();
      body.innerHTML = markdown.render(acc);
      body.appendChild(caret);
      if (stick) scrollToEnd();
    };

    let failure = null;
    try {
      const { url, init } = providers.buildRequest(s, target.messages);
      armStall();
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!res.ok) throw new Error(await readError(res));

      for await (const data of sseEvents(res, armStall)) {
        if (data === '[DONE]') break;
        let json;
        try { json = JSON.parse(data); } catch { continue; }
        const ev = providers.parseEvent(p.kind, json);
        if (ev.usage) usage = { ...(usage || {}), ...Object.fromEntries(Object.entries(ev.usage).filter(([, v]) => v != null)) };
        if (ev.stop) { stop = ev.stop; stopDetail = ev.stopDetail || ''; }
        if (!ev.text) continue;
        acc += ev.text;
        if (!paintQueued) {
          paintQueued = true;
          requestAnimationFrame(paint);
        }
      }
    } catch (err) {
      failure = describeFailure(err);
      if (err.name === 'AbortError' && err.message !== 'stall') stop = 'aborted';
    } finally {
      clearTimeout(stallTimer);
    }

    caret.remove();
    node.remove();
    setStreaming(false);
    controller = null;

    if (acc) {
      const m = { role: 'assistant', content: acc, model: s.model, at: Date.now() };
      if (usage) m.usage = usage;
      if (stop && stop !== 'end') { m.stop = stop; if (stopDetail) m.stopDetail = stopDetail; }
      target.messages.push(m);
      saveChat(target);
    }

    if (chat === target) {
      renderThread();
      if (failure) {
        addError(failure, { retry: acc ? null : stream });
      } else if (!acc && stop !== 'aborted') {
        // a 200 with no text is still a failed turn from the user's point of view
        const why = stop && stop !== 'end' ? stopNotice({ stop, stopDetail }).textContent : '';
        addError(why ? `Nggak ada jawaban. ${why}` : 'Provider nggak ngirim teks apa pun.', { retry: stream });
      }
      el.input.focus({ preventScroll: true });
    } else if (failure) {
      toast(`Jawaban di "${target.title}" gagal: ${failure}`, { duration: 6000 });
    }
    renderHistory();
  }

  function stop() {
    controller?.abort();
  }

  function regenerate() {
    if (!chat || controller) return;
    const last = chat.messages[chat.messages.length - 1];
    if (last?.role === 'assistant') chat.messages.pop();
    if (!chat.messages.length) return;
    saveChat(chat);
    renderThread();
    stream();
  }

  function continueReply() {
    if (!chat || controller) return;
    chat.messages.push({ role: 'user', content: 'Lanjutkan dari bagian yang terpotong, tanpa mengulang yang sudah ditulis.', at: Date.now() });
    saveChat(chat);
    renderThread();
    stream();
  }

  // ---------- test connection ----------

  // Enough to compare against the dashboard's "sk-...abcd" listing, never the whole key.
  function keyFingerprint(key) {
    if (!key) return 'kosong';
    const head = key.slice(0, Math.min(8, key.length - 4));
    return `${head}...${key.slice(-4)} (${key.length} karakter)`;
  }

  async function testConnection() {
    const problem = ready();
    if (problem) {
      setTestResult(problem.msg, 'bad');
      problem.field.focus();
      return;
    }
    const s = settings();
    const { url, init } = providers.testRequest(s);

    el.test.setAttribute('aria-busy', 'true');
    el.test.disabled = true;
    el.test.textContent = 'Mengecek...';
    setTestResult('', '');
    try {
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(await readError(res));
      setTestResult('Key diterima. Siap dipakai.', 'ok');
    } catch (err) {
      setTestResult(`${describeFailure(err) || 'Gagal.'} Key yang dikirim: ${keyFingerprint(s.apiKey)}.`, 'bad');
    } finally {
      el.test.removeAttribute('aria-busy');
      el.test.disabled = false;
      el.test.textContent = 'Tes koneksi';
    }
  }

  // ---------- export / import ----------

  function exportChats() {
    const data = store.exportAll();
    if (!data.chats.length) { toast('Belum ada obrolan yang bisa diexport.'); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `zpai-obrolan-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`${data.chats.length} obrolan diexport.`);
  }

  async function importChats(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const { added, skipped } = store.importAll(JSON.parse(text));
      renderHistory();
      toast(added ? `${added} obrolan diimport${skipped ? `, ${skipped} dilewati` : ''}.` : 'Nggak ada obrolan baru di file itu.');
    } catch (err) {
      toast(`Import gagal: ${err.message || 'file nggak kebaca'}.`, { duration: 5000 });
    }
  }

  // ---------- wiring ----------

  function init() {
    fillProviders();
    restoreSettings();
    updateStatus();
    syncDrawers();

    store.onQuota(() => toast('Penyimpanan browser penuh. Export lalu hapus obrolan lama.', { duration: 6000 }));

    const s = settings();
    const migrated = store.chats.migrate({ provider: s.provider, model: s.model });
    const activeId = migrated?.id || store.chats.activeId();
    chat = (activeId && store.chats.get(activeId)) || store.chats.create({ provider: s.provider, model: s.model });
    if (activeId && !chat.messages.length) store.chats.setActive(null);
    renderThread();
    renderHistory();

    // settings
    el.provider.addEventListener('change', () => { applyProvider(''); persistSettings(); });
    el.model.addEventListener('change', () => {
      const custom = el.model.value === CUSTOM_MODEL;
      el.modelCustom.hidden = !custom;
      if (custom) { el.modelCustom.value = ''; el.modelCustom.focus(); }
      persistSettings();
    });
    for (const f of [el.baseUrl, el.apiKey, el.modelCustom, el.system]) f.addEventListener('input', persistSettings);
    for (const f of [el.remember, el.matchTone]) f.addEventListener('change', persistSettings);
    el.showUsage.addEventListener('change', () => { persistSettings(); renderThread(); });
    el.apiKey.addEventListener('paste', () => {
      setTimeout(() => {
        const clean = el.apiKey.value.replace(/\s+/g, '');
        if (clean !== el.apiKey.value) { el.apiKey.value = clean; persistSettings(); }
      }, 0);
    });
    el.eye.addEventListener('click', () => {
      const show = el.apiKey.type === 'password';
      el.apiKey.type = show ? 'text' : 'password';
      el.eye.setAttribute('aria-pressed', String(show));
      el.eye.setAttribute('aria-label', show ? 'Sembunyikan key' : 'Tampilkan key');
      el.eyeIcon.setAttribute('href', show ? '#i-eye-off' : '#i-eye');
    });
    el.test.addEventListener('click', testConnection);
    el.exportBtn.addEventListener('click', exportChats);
    el.importBtn.addEventListener('click', () => el.importFile.click());
    el.importFile.addEventListener('change', () => { importChats(el.importFile.files[0]); el.importFile.value = ''; });
    el.clearBtn.addEventListener('click', clearAll);
    el.themeBtn.addEventListener('click', cycleTheme);

    // history
    el.newChat.addEventListener('click', () => startNew());
    el.search.addEventListener('input', renderHistory);
    el.linkSettings.addEventListener('click', () => { openDrawer('settings'); if (!isDrawer('settings')) el.apiKey.focus(); });

    // drawers
    el.historyBtn.addEventListener('click', () => toggleDrawer('history'));
    el.settingsBtn.addEventListener('click', () => toggleDrawer('settings'));
    el.backdrop.addEventListener('click', () => closeDrawer());
    for (const b of document.querySelectorAll('.drawer-close')) b.addEventListener('click', () => closeDrawer());
    SETTINGS_DRAWER.addEventListener('change', syncDrawers);
    HISTORY_DRAWER.addEventListener('change', syncDrawers);

    // composer
    el.composer.addEventListener('submit', (e) => {
      e.preventDefault();
      if (controller) { stop(); return; }
      const text = el.input.value.trim();
      if (!text) return;
      el.input.value = '';
      autosize();
      send(text);
    });
    el.editCancel.addEventListener('click', cancelEdit);
    el.input.addEventListener('input', autosize);
    el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (controller) { flashHint('Tunggu jawaban selesai, atau tekan Esc buat stop.'); return; }
        el.composer.requestSubmit();
      }
    });

    el.thread.addEventListener('scroll', updateJump, { passive: true });
    el.jump.addEventListener('click', () => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.thread.scrollTo({ top: el.thread.scrollHeight, behavior: reduce ? 'instant' : 'smooth' });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (controller) stop();
      else if (openDrawerName) closeDrawer();
      else if (editing >= 0 && document.activeElement === el.input) cancelEdit();
    });

    document.addEventListener('visibilitychange', () => { if (!document.hidden) renderHistory(); });
  }

  init();
})();

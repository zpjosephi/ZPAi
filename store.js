'use strict';

// Everything persistent lives in localStorage (keys optionally in
// sessionStorage). One index entry per chat plus one record per chat body, so
// opening the list never has to parse every conversation.

window.ZP = window.ZP || {};

(function () {
  const K = {
    settings: 'zpai.settings',
    index: 'zpai.chats',
    active: 'zpai.active',
    chat: (id) => `zpai.chat.${id}`,
    key: (p) => `zpai.key.${p}`,
    legacyThread: 'zpai.thread',
  };

  const TITLE_MAX = 48;
  const PREVIEW_MAX = 140;

  let quotaHandler = null;

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      if (quotaHandler) quotaHandler(err);
      return false;
    }
  }

  function remove(key) {
    try { localStorage.removeItem(key); } catch {}
  }

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID().slice(0, 8) + Date.now().toString(36);
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  // ---------- settings & keys ----------

  const settings = {
    get() { return readJSON(K.settings, {}); },
    set(patch) { return writeJSON(K.settings, { ...readJSON(K.settings, {}), ...patch }); },
  };

  const keys = {
    load(provider) {
      try {
        return localStorage.getItem(K.key(provider)) || sessionStorage.getItem(K.key(provider)) || '';
      } catch {
        return '';
      }
    },
    remembered(provider) {
      try { return !!localStorage.getItem(K.key(provider)); } catch { return false; }
    },
    save(provider, key, remember) {
      try {
        localStorage.removeItem(K.key(provider));
        sessionStorage.removeItem(K.key(provider));
        if (!key) return;
        (remember ? localStorage : sessionStorage).setItem(K.key(provider), key);
      } catch {}
    },
  };

  // ---------- chats ----------

  function titleFrom(text) {
    const line = String(text || '').split('\n').find((l) => l.trim()) || '';
    const clean = line.replace(/[#*`_>~[\]]/g, '').replace(/\s+/g, ' ').trim();
    if (!clean) return 'Obrolan baru';
    return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1).trimEnd()}...` : clean;
  }

  function readIndex() {
    const idx = readJSON(K.index, []);
    return Array.isArray(idx) ? idx : [];
  }

  function writeIndex(idx) {
    idx.sort((a, b) => b.updatedAt - a.updatedAt);
    return writeJSON(K.index, idx);
  }

  function entryFor(chat) {
    const firstUser = chat.messages.find((m) => m.role === 'user');
    return {
      id: chat.id,
      title: chat.title,
      provider: chat.provider,
      model: chat.model,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      count: chat.messages.length,
      preview: firstUser ? firstUser.content.slice(0, PREVIEW_MAX) : '',
    };
  }

  const chats = {
    index() { return readIndex(); },

    get(id) {
      const chat = readJSON(K.chat(id), null);
      return chat && Array.isArray(chat.messages) ? chat : null;
    },

    create({ provider, model }) {
      const now = Date.now();
      return { id: uid(), title: '', provider, model, createdAt: now, updatedAt: now, messages: [] };
    },

    // Saves the body and keeps the index entry in step. Empty chats are not
    // written at all so "new chat" never litters the list.
    save(chat) {
      if (!chat.messages.length) return true;
      chat.updatedAt = Date.now();
      if (!chat.title) chat.title = titleFrom(chat.messages.find((m) => m.role === 'user')?.content);
      if (!writeJSON(K.chat(chat.id), chat)) return false;
      const idx = readIndex().filter((e) => e.id !== chat.id);
      idx.push(entryFor(chat));
      return writeIndex(idx);
    },

    rename(id, title) {
      const chat = chats.get(id);
      const clean = title.trim();
      if (!chat || !clean) return false;
      chat.title = clean.length > TITLE_MAX * 2 ? clean.slice(0, TITLE_MAX * 2) : clean;
      chat.titleCustom = true;
      if (!writeJSON(K.chat(id), chat)) return false;
      const idx = readIndex();
      const e = idx.find((x) => x.id === id);
      if (e) e.title = chat.title;
      return writeIndex(idx);
    },

    delete(id) {
      remove(K.chat(id));
      writeIndex(readIndex().filter((e) => e.id !== id));
      if (chats.activeId() === id) chats.setActive(null);
    },

    // Puts a chat back exactly as it was (undo after delete).
    restore(chat) {
      if (!writeJSON(K.chat(chat.id), chat)) return false;
      const idx = readIndex().filter((e) => e.id !== chat.id);
      idx.push(entryFor(chat));
      return writeIndex(idx);
    },

    clearAll() {
      for (const e of readIndex()) remove(K.chat(e.id));
      remove(K.index);
      remove(K.active);
    },

    activeId() {
      try { return localStorage.getItem(K.active) || null; } catch { return null; }
    },

    setActive(id) {
      try {
        if (id) localStorage.setItem(K.active, id);
        else localStorage.removeItem(K.active);
      } catch {}
    },

    // First-release layout kept a single thread under one key. Fold it into
    // the new per-chat layout once, then drop the old key.
    migrate(fallback) {
      const old = readJSON(K.legacyThread, null);
      if (!Array.isArray(old)) return null;
      remove(K.legacyThread);
      const msgs = old.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
      if (!msgs.length) return null;
      const chat = chats.create(fallback);
      const who = msgs.find((m) => m.role === 'assistant')?.who;
      if (who) chat.model = who;
      chat.messages = msgs.map((m) => ({ role: m.role, content: m.content, model: m.who || undefined, at: chat.createdAt }));
      chats.save(chat);
      return chat;
    },
  };

  // ---------- export / import ----------

  function exportAll() {
    const idx = readIndex();
    const list = idx.map((e) => chats.get(e.id)).filter(Boolean);
    return { app: 'zpai', version: 1, exportedAt: new Date().toISOString(), chats: list };
  }

  function sanitizeChat(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.messages)) return null;
    const messages = raw.messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({
        role: m.role,
        content: m.content,
        ...(typeof m.model === 'string' ? { model: m.model } : {}),
        ...(m.usage && typeof m.usage === 'object' ? { usage: m.usage } : {}),
        ...(m.stop && typeof m.stop === 'string' ? { stop: m.stop } : {}),
        at: Number.isFinite(m.at) ? m.at : Date.now(),
      }));
    if (!messages.length) return null;
    const now = Date.now();
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
      title: typeof raw.title === 'string' ? raw.title.slice(0, TITLE_MAX * 2) : '',
      titleCustom: !!raw.titleCustom,
      provider: typeof raw.provider === 'string' ? raw.provider : 'custom',
      model: typeof raw.model === 'string' ? raw.model : '',
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : now,
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : now,
      messages,
    };
  }

  // Existing ids are kept, incoming duplicates are skipped. Returns counts so
  // the UI can say exactly what happened.
  function importAll(data) {
    const list = Array.isArray(data) ? data : data?.chats;
    if (!Array.isArray(list)) throw new Error('bukan file export ZPAi');
    const have = new Set(readIndex().map((e) => e.id));
    let added = 0; let skipped = 0;
    for (const raw of list) {
      const chat = sanitizeChat(raw);
      if (!chat) { skipped++; continue; }
      if (have.has(chat.id)) { skipped++; continue; }
      if (!chat.title) chat.title = titleFrom(chat.messages.find((m) => m.role === 'user')?.content);
      if (!chats.restore(chat)) throw new Error('penyimpanan browser penuh');
      have.add(chat.id);
      added++;
    }
    return { added, skipped };
  }

  ZP.store = {
    settings,
    keys,
    chats,
    exportAll,
    importAll,
    titleFrom,
    onQuota(fn) { quotaHandler = fn; },
  };
})();

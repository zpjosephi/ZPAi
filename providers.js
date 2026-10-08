'use strict';

// Provider catalog plus the two things that differ per provider: how to build
// the streaming request, and how to pull text / usage / stop reason out of one
// SSE event. Everything else in the app is provider-agnostic.

window.ZP = window.ZP || {};

(function () {
  const PROVIDERS = {
    openai: {
      name: 'OpenAI',
      kind: 'openai',
      base: 'https://api.openai.com/v1',
      keyUrl: 'https://platform.openai.com/api-keys',
      placeholder: 'sk-...',
      models: ['gpt-5.5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o-mini'],
    },
    anthropic: {
      name: 'Anthropic',
      kind: 'anthropic',
      base: 'https://api.anthropic.com/v1',
      keyUrl: 'https://console.anthropic.com/settings/keys',
      placeholder: 'sk-ant-...',
      models: ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
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
      optionalKey: true,
    },
  };

  const TONE_NOTE = 'Sesuaikan nada dan pilihan kata dengan cara pengguna menulis. Kalau pengguna santai, jawab santai; kalau formal, jawab formal; kalau pakai bahasa tertentu, pakai bahasa yang sama.';

  const ANTHROPIC_MAX_TOKENS = 16384;

  function baseUrl(s) {
    const p = PROVIDERS[s.provider];
    return (p.editableBase ? s.baseUrl : p.base).replace(/\/+$/, '');
  }

  function composeSystem(s) {
    const parts = [];
    if (s.system) parts.push(s.system);
    if (s.matchTone) parts.push(TONE_NOTE);
    return parts.join('\n\n');
  }

  function authHeaders(s) {
    const p = PROVIDERS[s.provider];
    const h = {};
    if (p.kind === 'anthropic') {
      h['x-api-key'] = s.apiKey;
      h['anthropic-version'] = '2023-06-01';
      h['anthropic-dangerous-direct-browser-access'] = 'true';
    } else if (p.kind === 'gemini') {
      h['x-goog-api-key'] = s.apiKey;
    } else if (s.apiKey) {
      h.authorization = `Bearer ${s.apiKey}`;
    }
    if (s.provider === 'openrouter') h['x-title'] = 'ZPAi';
    return h;
  }

  function buildRequest(s, messages) {
    const p = PROVIDERS[s.provider];
    const base = baseUrl(s);
    const system = composeSystem(s);
    const headers = { 'content-type': 'application/json', ...authHeaders(s) };

    if (p.kind === 'anthropic') {
      return {
        url: `${base}/messages`,
        init: {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: s.model,
            max_tokens: ANTHROPIC_MAX_TOKENS,
            stream: true,
            ...(system ? { system } : {}),
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
          headers,
          body: JSON.stringify({
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            contents: messages.map((m) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            })),
          }),
        },
      };
    }

    return {
      url: `${base}/chat/completions`,
      init: {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: s.model,
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
        }),
      },
    };
  }

  function testRequest(s) {
    return { url: `${baseUrl(s)}/models`, init: { headers: authHeaders(s) } };
  }

  // Normalised view of one SSE event. `stop` is one of: end, length, refusal,
  // filter, other. Throws when the event itself is an error payload.
  function parseEvent(kind, data) {
    const ev = {};

    if (kind === 'anthropic') {
      if (data.type === 'error') throw new Error(data.error?.message || 'Anthropic error');
      if (data.type === 'message_start') {
        const u = data.message?.usage;
        if (u) ev.usage = { input: u.input_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens };
      } else if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
        ev.text = data.delta.text;
      } else if (data.type === 'message_delta') {
        if (data.usage) ev.usage = { output: data.usage.output_tokens };
        const r = data.delta?.stop_reason;
        if (r === 'max_tokens') ev.stop = 'length';
        else if (r === 'refusal') { ev.stop = 'refusal'; ev.stopDetail = data.delta?.stop_details?.category || ''; }
        else if (r) ev.stop = 'end';
      }
      return ev;
    }

    if (kind === 'gemini') {
      if (data.error) throw new Error(data.error.message || 'Gemini error');
      if (data.promptFeedback?.blockReason) { ev.stop = 'filter'; ev.stopDetail = data.promptFeedback.blockReason; }
      const cand = data.candidates?.[0];
      if (cand) {
        ev.text = (cand.content?.parts || []).map((x) => x.text || '').join('');
        const r = cand.finishReason;
        if (r === 'MAX_TOKENS') ev.stop = 'length';
        else if (r === 'SAFETY' || r === 'RECITATION' || r === 'BLOCKLIST' || r === 'PROHIBITED_CONTENT' || r === 'SPII') { ev.stop = 'filter'; ev.stopDetail = r; }
        else if (r === 'STOP') ev.stop = 'end';
        else if (r) { ev.stop = 'other'; ev.stopDetail = r; }
      }
      const u = data.usageMetadata;
      if (u) ev.usage = { input: u.promptTokenCount, output: u.candidatesTokenCount };
      return ev;
    }

    if (data.error) throw new Error(data.error.message || (typeof data.error === 'string' ? data.error : 'API error'));
    const choice = data.choices?.[0];
    if (choice) {
      ev.text = choice.delta?.content || '';
      const r = choice.finish_reason;
      if (r === 'length') ev.stop = 'length';
      else if (r === 'content_filter') ev.stop = 'filter';
      else if (r === 'stop') ev.stop = 'end';
      else if (r) { ev.stop = 'other'; ev.stopDetail = r; }
    }
    const u = data.usage || data.x_groq?.usage;
    if (u) ev.usage = { input: u.prompt_tokens, output: u.completion_tokens };
    return ev;
  }

  ZP.providers = { list: PROVIDERS, baseUrl, composeSystem, buildRequest, testRequest, parseEvent };
})();

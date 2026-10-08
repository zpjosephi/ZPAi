'use strict';

// Small markdown renderer for chat replies. Covers what models actually emit:
// fences, headings, lists (nested), blockquotes, tables, hr, and inline marks.
// Everything is escaped before any tag is inserted, so model output can't
// smuggle HTML in.

window.ZP = window.ZP || {};

(function () {
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- inline ----------

  const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
  const URL_RE = /(^|[\s(])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

  function inlineText(raw) {
    // private-use codepoints mark pulled-out html so later passes skip it
    const slots = [];
    const slot = (html) => `${slots.push(html) - 1}`;

    let out = escapeHtml(raw);

    out = out.replace(LINK_RE, (_, text, url) => slot(`<a href="${url}" target="_blank" rel="noopener">${text}</a>`));
    out = out.replace(URL_RE, (_, lead, url) => `${lead}${slot(`<a href="${url}" target="_blank" rel="noopener">${url}</a>`)}`);

    out = out.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/__([^_\n]+?)__/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>');
    out = out.replace(/(^|[^_\w])_([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>');
    out = out.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');

    return out.replace(/(\d+)/g, (_, i) => slots[Number(i)]);
  }

  function inline(text) {
    // code spans are opaque: pull them out first so marks inside them stay literal
    const parts = text.split(/(`+)([^`\n]*?[^`\n])\1(?!`)/);
    // split with 2 capture groups yields [text, ticks, code, text, ticks, code, ...]
    let html = '';
    for (let i = 0; i < parts.length; i += 3) {
      html += inlineText(parts[i]);
      if (i + 2 < parts.length) html += `<code>${escapeHtml(parts[i + 2])}</code>`;
    }
    return html;
  }

  // ---------- blocks ----------

  const FENCE_RE = /^\s{0,3}(```+|~~~+)\s*([\w+-]*)\s*$/;
  const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
  const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
  const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
  const UL_RE = /^(\s*)([-*+])\s+(.*)$/;
  const OL_RE = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
  const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

  function isBlank(line) { return /^\s*$/.test(line); }

  function startsBlock(line) {
    return FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line) || QUOTE_RE.test(line) || UL_RE.test(line) || OL_RE.test(line);
  }

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  }

  function renderTable(lines, i, out) {
    const header = splitRow(lines[i]);
    const aligns = splitRow(lines[i + 1]).map((c) => {
      const l = c.startsWith(':'); const r = c.endsWith(':');
      return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
    });
    i += 2;
    const rows = [];
    while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) rows.push(splitRow(lines[i++]));

    const cell = (tag, text, k) => `<${tag}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ''}>${inline(text)}</${tag}>`;
    let html = '<div class="table-wrap"><table><thead><tr>';
    html += header.map((h, k) => cell('th', h, k)).join('');
    html += '</tr></thead>';
    if (rows.length) {
      html += '<tbody>';
      for (const r of rows) {
        html += '<tr>';
        for (let k = 0; k < header.length; k++) html += cell('td', r[k] ?? '', k);
        html += '</tr>';
      }
      html += '</tbody>';
    }
    html += '</table></div>';
    out.push(html);
    return i;
  }

  function renderList(lines, i, out) {
    const first = lines[i].match(UL_RE) || lines[i].match(OL_RE);
    const ordered = /\d/.test(first[2]);
    const indent = first[1].length;
    const re = ordered ? OL_RE : UL_RE;
    const items = [];

    while (i < lines.length) {
      const m = lines[i].match(re);
      if (m && m[1].length === indent) {
        items.push([m[3]]);
        i++;
        continue;
      }
      if (!items.length) break;
      const cur = items[items.length - 1];
      // deeper-indented or blank lines belong to the current item
      if (isBlank(lines[i])) {
        if (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && lines[i + 1].search(/\S/) > indent) { cur.push(''); i++; continue; }
        break;
      }
      const lead = lines[i].search(/\S/);
      if (lead > indent) { cur.push(lines[i].slice(Math.min(lead, indent + 2))); i++; continue; }
      break;
    }

    const start = ordered && first[2] !== '1' ? ` start="${Number(first[2])}"` : '';
    let html = `<${ordered ? 'ol' : 'ul'}${start}>`;
    for (const item of items) {
      let body = renderBlocks(item.join('\n'));
      // tight item (no blank line inside): the leading paragraph needs no <p>
      if (!item.includes('')) body = body.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
      html += `<li>${body}</li>`;
    }
    html += `</${ordered ? 'ol' : 'ul'}>`;
    out.push(html);
    return i;
  }

  function renderBlocks(src) {
    const lines = src.split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (isBlank(line)) { i++; continue; }

      const fence = line.match(FENCE_RE);
      if (fence) {
        const close = new RegExp(`^\\s{0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
        const code = [];
        i++;
        while (i < lines.length && !close.test(lines[i])) code.push(lines[i++]);
        i++;
        const cls = fence[2] ? ` class="lang-${escapeHtml(fence[2])}"` : '';
        out.push(`<pre><code${cls}>${escapeHtml(code.join('\n'))}</code></pre>`);
        continue;
      }

      const h = line.match(HEADING_RE);
      if (h) {
        const level = Math.min(h[1].length, 4);
        out.push(`<h${level}>${inline(h[2])}</h${level}>`);
        i++;
        continue;
      }

      if (HR_RE.test(line)) { out.push('<hr>'); i++; continue; }

      if (QUOTE_RE.test(line)) {
        const inner = [];
        while (i < lines.length && QUOTE_RE.test(lines[i])) inner.push(lines[i++].match(QUOTE_RE)[1]);
        out.push(`<blockquote>${renderBlocks(inner.join('\n'))}</blockquote>`);
        continue;
      }

      if (UL_RE.test(line) || OL_RE.test(line)) { i = renderList(lines, i, out); continue; }

      if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) { i = renderTable(lines, i, out); continue; }

      const para = [];
      while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i])) {
        if (lines[i].includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) break;
        para.push(lines[i++]);
      }
      if (para.length) out.push(`<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
    }
    return out.join('');
  }

  function render(src) {
    return renderBlocks(String(src ?? '').replace(/\r\n?/g, '\n'));
  }

  ZP.markdown = { render, escapeHtml };
})();

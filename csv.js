/* Eng word — импорт и экспорт CSV. Понимает запятую, точку с запятой и табуляцию, кавычки, BOM, UTF-8 и Windows-1251. */
(function () {
  'use strict';
  const EW = (window.EW = window.EW || {});

  const ALIASES = {
    en: ['en', 'eng', 'english', 'word', 'английский', 'англ', 'английское', 'английское слово', 'слово', 'английский вариант'],
    ru: ['ru', 'rus', 'russian', 'русский', 'русское', 'русское слово', 'перевод', 'translation', 'русский вариант'],
    tr: ['tr', 'transcription', 'транскрипция', 'ipa', 'phonetic', 'произношение'],
    exEn: ['example', 'example_en', 'example en', 'ex_en', 'ex en', 'пример', 'пример_en', 'пример en', 'пример (en)', 'пример англ', 'пример_англ', 'пример на английском'],
    exRu: ['example_ru', 'example ru', 'ex_ru', 'ex ru', 'пример_ru', 'пример ru', 'пример (ru)', 'пример перевод', 'перевод примера', 'пример_перевод', 'example translation', 'пример на русском'],
  };
  const FIELD_ORDER = ['en', 'ru', 'tr', 'exEn', 'exRu'];

  function decode(buf) {
    const u8 = new Uint8Array(buf);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(u8);
    } catch (e) {
      try { return new TextDecoder('windows-1251').decode(u8); } catch (e2) { return new TextDecoder('utf-8').decode(u8); }
    }
  }

  function detectDelim(text) {
    const line = (text.split(/\r?\n/).find((l) => l.trim()) || '');
    let q = false;
    const cnt = { ',': 0, ';': 0, '\t': 0 };
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (!q && ch in cnt) cnt[ch]++;
    }
    let best = ',', n = -1;
    for (const k of [';', '\t', ',']) if (cnt[k] > n) { n = cnt[k]; best = k; }
    return n > 0 ? best : ',';
  }

  function parseRows(text, delim) {
    const rows = [];
    let row = [], cur = '', q = false, i = 0;
    const n = text.length;
    while (i < n) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        cur += ch; i++; continue;
      }
      if (ch === '"' && cur === '') { q = true; i++; continue; }
      if (ch === delim) { row.push(cur); cur = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; i++; continue; }
      cur += ch; i++;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const cyr = (s) => (String(s).match(/[а-яё]/gi) || []).length;
  const lat = (s) => (String(s).match(/[a-z]/gi) || []).length;

  function cleanTr(s) {
    s = String(s || '').trim();
    s = s.replace(/^[\[\/]+/, '').replace(/[\]\/]+$/, '').trim();
    return s;
  }

  function splitExamples(en, ru) {
    const a = String(en || '').split('|').map((x) => x.trim());
    const b = String(ru || '').split('|').map((x) => x.trim());
    const out = [];
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] || b[i]) out.push({ en: a[i] || '', ru: b[i] || '' });
    return out;
  }

  /**
   * parse(text) → { rows:[{line,en,ru,tr,ex:[{en,ru}]}], errors:[{line,msg}], delim, hasHeader, swapped, total }
   */
  function parse(text) {
    text = String(text || '').replace(/^﻿/, '');
    const delim = detectDelim(text);
    const all = parseRows(text, delim);
    const res = { rows: [], errors: [], delim, hasHeader: false, swapped: false, swappedRows: 0, total: 0 };
    if (!all.length) return res;

    // заголовок?
    const map = {};
    const head = all[0].map(norm);
    for (const f of FIELD_ORDER) {
      const idx = head.findIndex((h) => ALIASES[f].includes(h));
      if (idx >= 0) map[f] = idx;
    }
    let start = 0;
    if (map.en != null || map.ru != null) {
      res.hasHeader = true;
      start = 1;
      if (map.en == null) map.en = head.findIndex((h, i) => i !== map.ru && !Object.values(map).includes(i));
      if (map.ru == null) map.ru = head.findIndex((h, i) => i !== map.en && !Object.values(map).includes(i));
    } else {
      FIELD_ORDER.forEach((f, i) => (map[f] = i));
    }

    const seen = new Set();
    for (let i = start; i < all.length; i++) {
      const r = all[i];
      const line = i + 1;
      const g = (f) => (map[f] != null && map[f] >= 0 ? String(r[map[f]] == null ? '' : r[map[f]]).trim() : '');
      let en = g('en'), ru = g('ru');
      res.total++;
      // если «английская» колонка по сути русская, а «русская» английская, меняем эту строку местами
      if (en && ru && cyr(en) > lat(en) && lat(ru) > cyr(ru)) { const t = en; en = ru; ru = t; res.swappedRows = (res.swappedRows || 0) + 1; res.swapped = true; }
      if (!en && !ru) continue;
      if (!en) { res.errors.push({ line, msg: 'нет английского слова' }); continue; }
      if (!ru) { res.errors.push({ line, msg: 'нет перевода: «' + en + '»' }); continue; }
      const key = norm(en);
      if (seen.has(key)) { res.errors.push({ line, msg: 'повтор в файле: «' + en + '»' }); continue; }
      seen.add(key);
      res.rows.push({ line, en, ru, tr: cleanTr(g('tr')), ex: splitExamples(g('exEn'), g('exRu')) });
    }
    return res;
  }

  function esc(v, d) {
    v = String(v == null ? '' : v);
    return v.includes('"') || v.includes(d) || /[\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  // Экспорт: «;» и BOM, чтобы русский Excel открыл файл без «кракозябр»
  function stringify(words) {
    const d = ';';
    const lines = [['en', 'ru', 'transcription', 'example_en', 'example_ru'].join(d)];
    for (const w of words) {
      const exs = (w.ex || []).filter((e) => e.en || e.ru);
      lines.push([w.en, w.ru, w.tr || '', exs.map((e) => e.en).join(' | '), exs.map((e) => e.ru).join(' | ')].map((v) => esc(v, d)).join(d));
    }
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  const TEMPLATE =
    '﻿en;ru;transcription;example_en;example_ru\r\n' +
    'apple;яблоко;ˈæp.əl;I eat an apple every day.;Я ем яблоко каждый день.\r\n' +
    'beautiful;красивый;ˈbjuː.tɪ.fəl;What a beautiful view! | She has a beautiful voice.;Какой красивый вид! | У неё красивый голос.\r\n' +
    'to run;бежать;rʌn;He runs every morning.;Он бегает каждое утро.\r\n';

  EW.csv = { parse, stringify, decode, TEMPLATE, norm };
})();

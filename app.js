/* English Words — интерфейс */
(function () {
  'use strict';
  const EW = window.EW;
  const core = EW.core, M = core.meta, srs = EW.srs, D = EW.drive, tts = EW.tts, csv = EW.csv;

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svg = (d) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
  const I = {
    speaker: svg('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'),
    close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
    undo: svg('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
    clip: svg('<path d="m21.4 11-9.2 9.2a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5"/>'),
  };

  const view = $('#view');
  let tab = 'study';
  let study = null;
  let form = null;
  let imp = null;
  let dm = null;
  const wordsUI = { q: '', filter: 'all', limit: 80 };
  let viewerUrl = '';
  let installEvt = null;

  /* ---------- общее ---------- */
  const S = () => core.S;
  const PR = () => core.S.settings; // настройки: они синхронизируются между устройствами
  const getWord = (id) => { const w = core.get('words', id); return w && !w.d ? w : null; };
  const liveWords = () => core.live('words');
  /* ---------- словари ---------- */
  const liveDicts = () => core.live('dicts').sort((a, b) => (a.c || 0) - (b.c || 0) || a.name.localeCompare(b.name, 'ru'));
  const dictName = (id) => { const d = core.get('dicts', id); return d && !d.d ? d.name : '—'; };
  function curId() {
    const ds = core.live('dicts');
    const c = PR().cur;
    if (c === 'all' && ds.length > 1) return 'all';
    if (ds.some((d) => d.id === c)) return c;
    return (ds.find((d) => d.id === 'main') || ds[0] || { id: 'main' }).id;
  }
  // Выбранный словарь синхронизируется вместе с остальными настройками; сам commit делает вызывающий код
  function setCur(id) { if (PR().cur !== id) core.setSettings({ cur: id }); }
  function inScope(sc) {
    const all = liveWords();
    if (sc === 'all') return all;
    const r = core.dictResolver();
    return all.filter((w) => r(w) === sc);
  }
  const scopeWords = () => inScope(curId());
  const scopeLabel = (sc) => (sc === 'all' ? 'Все словари' : dictName(sc));
  function dictCounts() {
    const r = core.dictResolver(), n = {};
    let all = 0;
    for (const w of liveWords()) { const id = r(w); n[id] = (n[id] || 0) + 1; all++; }
    n.all = all;
    return n;
  }
  function dictBarHTML() {
    const ds = liveDicts(), cur = curId(), n = dictCounts();
    return '<div class="dictbar"><select id="d-sel" aria-label="Словарь">' +
      ds.map((d) => '<option value="' + esc(d.id) + '"' + (d.id === cur ? ' selected' : '') + '>' + esc(d.name) + ' (' + (n[d.id] || 0) + ')</option>').join('') +
      (ds.length > 1 ? '<option value="all"' + (cur === 'all' ? ' selected' : '') + '>Все словари (' + n.all + ')</option>' : '') +
      '</select><button type="button" class="btn" data-act="dicts">Словари</button></div>';
  }
  const dictOptions = (sel) => liveDicts().map((d) => '<option value="' + esc(d.id) + '"' + (d.id === sel ? ' selected' : '') + '>' + esc(d.name) + '</option>').join('');
  function wordsOfDict(id) { return inScope(id); }
  function dictNameError(name, exceptId) {
    name = (name || '').trim();
    if (!name) return 'Введите название словаря';
    if (name.length > 40) return 'Название не длиннее 40 символов';
    if (liveDicts().some((d) => d.id !== exceptId && d.name.trim().toLowerCase() === name.toLowerCase())) return 'Словарь с таким названием уже есть';
    return '';
  }
  function fmtSize(b) {
    b = +b || 0;
    if (b < 1024) return b + ' Б';
    if (b < 1048576) return Math.round(b / 1024) + ' КБ';
    return (Math.round((b / 1048576) * 10) / 10).toString().replace('.', ',') + ' МБ';
  }
  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
  }
  function speakText(text) {
    if (!tts.supported) { toast('Этот браузер не умеет озвучивать текст'); return; }
    if (!text) return;
    tts.speak(text, { accent: PR().accent, voice: PR().voice, rate: PR().rate }).then((ok) => {
      if (ok) return;
      if (!tts.list().length) toast('На устройстве нет английского голоса. Установите его: Настройки → Универсальный доступ → Устный контент → Голоса');
      else if (tts.state.lastError) toast('Не удалось озвучить. На iPhone проверьте, что выключен беззвучный режим (переключатель сбоку) и включён звук.');
    });
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([text], { type: type || 'text/csv;charset=utf-8' }));
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const dateStr = () => new Date().toISOString().slice(0, 10);

  /* ---------- шапка ---------- */
  function updateChip() {
    const c = $('#chip');
    const st = D.status;
    let txt = 'Только на этом устройстве';
    if (M.signedIn) {
      if (st.k === 'sync') txt = 'Синхронизация…';
      else if (st.k === 'ok') txt = 'Синхронизировано' + (M.lastSync ? ' в ' + new Date(M.lastSync).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '');
      else if (st.k === 'authneeded') txt = 'Нужен вход';
      else if (st.k === 'offline') txt = 'Нет сети';
      else if (st.k === 'error') txt = 'Ошибка синхронизации';
    }
    c.textContent = txt;
    c.className = 'chip' + (M.signedIn ? ' ' + st.k : '');
    c.title = M.signedIn && st.msg ? st.msg : '';
    const sc = $('#syncCard');
    if (sc) sc.innerHTML = syncCardHTML();
  }

  /* ---------- вкладки ---------- */
  function show(t) {
    tab = t;
    view.dataset.tab = '';
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    updateChip();
    if (study) return;
    if (tab === 'study') renderHome();
    else if (tab === 'words') renderWords();
    else renderSettings();
  }
  function onChanged() {
    if (study) { updateChip(); return; }
    if (tab === 'settings') { updateChip(); refreshData(); return; }
    render();
  }

  /* ---------- главная ---------- */
  function opts() { const s = S().settings; return { dirs: s.dirs, newPerDay: s.newPerDay, maxDays: s.maxDays }; }
  function streak() {
    const m = new Map(S().days.filter((d) => !d.d).map((d) => [d.id, d]));
    let d = srs.dayNum();
    if (!(m.get('d' + d) && m.get('d' + d).n > 0)) d--;
    let s = 0;
    while (m.get('d' + d) && m.get('d' + d).n > 0) { s++; d--; }
    return s;
  }
  function renderHome() {
    view.dataset.tab = 'study';
    const words = scopeWords();
    const bar = dictBarHTML();
    if (!words.length) {
      const sc = curId();
      const some = liveWords().length > 0;
      view.innerHTML = bar +
        '<div class="card empty-state"><h2>' + (some ? 'В этом словаре пока нет слов' : 'Начнём учить слова') + '</h2><p>' + (some ? 'Добавьте слово или загрузите слова из CSV-файла в словарь «' + esc(scopeLabel(sc)) + '». Можно выбрать другой словарь вверху.' : 'Добавьте первое слово или загрузите сразу много из CSV-файла. Приложение само подскажет, когда повторять каждое слово.') + '</p>' +
        '<div class="row wrap" style="justify-content:center"><button class="btn primary" data-act="add">' + I.plus + 'Добавить слово</button><button class="btn" data-act="import">Импорт из CSV</button></div></div>';
      return;
    }
    const st = srs.stats(words, opts());
    const todo = st.learn + st.review + st.newLeft;
    const today = srs.dayNum();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = core.get('days', 'd' + (today - i));
      days.push({ n: d && !d.d ? d.n : 0, label: new Date(Date.now() - i * 864e5).toLocaleDateString('ru-RU', { weekday: 'short' }) });
    }
    const max = Math.max(1, ...days.map((d) => d.n));
    const todayN = days[6].n;
    const sk = streak();
    view.innerHTML = bar +
      '<div class="card"><div class="stat-grid">' +
      '<div class="stat accent"><b id="n-due">' + (st.learn + st.review) + '</b><span>повторить сейчас</span></div>' +
      '<div class="stat"><b id="n-new">' + st.newLeft + '</b><span>новых на сегодня</span></div>' +
      '<div class="stat"><b>' + st.total + '</b><span>всего слов</span></div>' +
      '<div class="stat"><b>' + st.mastered + '</b><span>прочно выучено</span></div></div>' +
      '<div class="study-btns"><button class="btn primary big" data-act="study-start" data-mode="review"' + (st.reviewTotal ? '' : ' disabled') + '>Повторять слова<small>' + (st.reviewTotal ? 'готово: ' + st.reviewTotal : 'пока нечего') + '</small></button>' +
      '<button class="btn primary big alt" data-act="study-start" data-mode="new"' + (st.newTotal ? '' : ' disabled') + '>Учить новые слова<small>' + (st.newTotal ? 'на сегодня: ' + st.newTotal : (st.newEligible ? 'лимит на сегодня выбран' : 'новых слов нет')) + '</small></button>' +
      (!st.newLeft && st.newEligible ? '<button class="btn big" data-act="more-new">Изучить новые слова сегодня<small>ещё можно: ' + wordsWord(st.newEligible) + '</small></button>' : '') + '</div>' +
      (todo ? '' : '<p class="muted small" style="text-align:center;margin:10px 0 0">Следующие карточки появятся по расписанию. Можно добавить новые слова.</p>') +
      '</div>' +
      '<div class="card"><h3>Активность</h3><div class="muted small">Сегодня повторено: ' + todayN + (sk ? ' · дней подряд: ' + sk : '') + '</div>' +
      '<div class="bars">' + days.map((d) => '<div class="' + (d.n ? '' : 'empty') + '" title="' + d.n + '"><i style="height:' + Math.max(4, Math.round((d.n / max) * 40)) + 'px"></i><span>' + esc(d.label) + '</span></div>').join('') + '</div></div>';
  }

  /* ---------- список слов ---------- */
  const STATE_LABEL = { new: 'Новое', due: 'Пора повторить', learning: 'Учится', review: 'Выучивается' };
  function renderWords() {
    if (view.dataset.tab !== 'words') {
      view.dataset.tab = 'words';
      view.innerHTML =
        '<div id="dictbar"></div><div class="toolbar"><input type="search" id="w-q" class="grow" placeholder="Поиск по словам" value="' + esc(wordsUI.q) + '" aria-label="Поиск">' +
        '<select id="w-f" aria-label="Фильтр" style="width:auto"><option value="all">Все</option><option value="new">Новые</option><option value="due">К повторению</option><option value="learning">Учатся</option><option value="review">Выучиваются</option></select></div>' +
        '<div class="toolbar"><button class="btn primary" data-act="add">' + I.plus + 'Добавить</button><button class="btn" data-act="import">Импорт</button><button class="btn" data-act="export">Экспорт</button></div>' +
        '<div class="muted small" id="wcount" style="margin-bottom:8px"></div><div class="wlist" id="wlist"></div><div class="more" id="wmore"></div>';
      $('#w-f').value = wordsUI.filter;
    }
    const bh = dictBarHTML(), bar = $('#dictbar');
    if (bar && bar.dataset.h !== bh) { bar.innerHTML = bh; bar.dataset.h = bh; }
    renderWordList();
  }
  function renderWordList() {
    const q = wordsUI.q.trim().toLowerCase();
    const now = Date.now();
    const sc = curId();
    const many = sc === 'all';
    const rs = many ? core.dictResolver() : null;
    let list = scopeWords();
    const total = list.length;
    if (q) list = list.filter((w) => w.en.toLowerCase().includes(q) || w.ru.toLowerCase().includes(q));
    if (wordsUI.filter !== 'all') list = list.filter((w) => srs.wordState(w, now, opts()) === wordsUI.filter);
    list.sort((a, b) => (b.c || 0) - (a.c || 0));
    const shown = list.slice(0, wordsUI.limit);
    $('#wcount').textContent = total ? 'Слов: ' + total + (list.length !== total ? ' · найдено: ' + list.length : '') : '';
    $('#wlist').innerHTML = shown.length
      ? shown.map((w) => {
          const s = srs.wordState(w, now, opts());
          const lv = srs.wordLevel(w);
          return '<div class="wi" data-act="edit" data-id="' + esc(w.id) + '"><div class="wi-main"><div class="wi-en">' + esc(w.en) +
            (w.tr ? '<span class="wi-tr">[' + esc(w.tr) + ']</span>' : '') + '<span class="badge ' + s + '">' + STATE_LABEL[s] + '</span>' + (lv ? '<span class="badge lvl">ур. ' + lv + '</span>' : '') + '</div><div class="wi-ru">' + esc(w.ru) + (many ? ' <span class="wi-dict">· ' + esc(dictName(rs(w))) + '</span>' : '') + '</div></div>' +
            '<button class="icon-btn plain" data-act="speak" data-text="' + esc(w.en) + '" aria-label="Произнести">' + I.speaker + '</button></div>';
        }).join('')
      : '<div class="card empty-state" style="box-shadow:none"><p>' + (total ? 'Ничего не найдено.' : 'В этом словаре слов пока нет. Нажмите «Добавить» или загрузите CSV.') + '</p></div>';
    $('#wmore').innerHTML = list.length > shown.length ? '<button class="btn" data-act="more">Показать ещё (' + (list.length - shown.length) + ')</button>' : '';
  }

  /* ---------- окна ---------- */
  function openModal(html, cls) {
    $('#modal-root').innerHTML = '<div class="overlay" data-act="modal-bg"><div class="sheet ' + (cls || '') + '" role="dialog" aria-modal="true">' + html + '</div></div>';
    document.body.classList.add('noscroll');
  }
  function closeModal() {
    if (form && form.busy) return;
    $('#modal-root').innerHTML = '';
    if (!study) document.body.classList.remove('noscroll');
    form = null; imp = null; dm = null;
  }
  function closeViewer() {
    const r = $('#viewer-root');
    if (r) r.innerHTML = '';
    if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = ''; }
  }

  /* ---------- форма слова ---------- */
  function openWordForm(id) {
    const w = id ? getWord(id) : null;
    const dsel = w ? core.dictId(w) : (curId() === 'all' ? core.dictId({}) : curId());
    form = { id: w ? w.id : '', dict: dsel, ex: w && w.ex ? JSON.parse(JSON.stringify(w.ex)) : [], keep: w && w.fl ? w.fl.slice() : [], orig: w && w.fl ? w.fl.slice() : [], pending: [], busy: false };
    if (!form.ex.length) form.ex.push({ en: '', ru: '' });
    openModal(
      '<form id="wf" autocomplete="off" novalidate><h2>' + (w ? 'Слово' : 'Новое слово') + '</h2>' +
      '<label>Английское слово<div class="row"><input type="text" id="f-en" class="grow" lang="en" autocapitalize="none" spellcheck="false" value="' + esc(w ? w.en : '') + '"><button type="button" class="icon-btn" data-act="speak-field" aria-label="Произнести">' + I.speaker + '</button></div></label>' +
      '<div class="note" id="dup" hidden></div>' +
      (liveDicts().length > 1 ? '<label>Словарь<select id="f-dict">' + dictOptions(dsel) + '</select></label>' : '') +
      '<label>Транскрипция<input type="text" id="f-tr" autocapitalize="none" spellcheck="false" placeholder="например: ˈæp.əl" value="' + esc(w ? w.tr : '') + '"></label>' +
      '<label>Перевод на русский<input type="text" id="f-ru" lang="ru" value="' + esc(w ? w.ru : '') + '"></label>' +
      '<div class="sect"><div class="sect-h">Примеры</div><div id="exRows">' + exHTML() + '</div><button type="button" class="btn ghost" data-act="ex-add">' + I.plus + 'Добавить пример</button></div>' +
      levelHTML(w) +
      '<div class="sect"><div class="sect-h">Файлы</div><div id="attList">' + attHTML() + '</div>' + attPickHTML() + '</div>' +
      '<div class="note err" id="f-err" hidden></div><div class="muted small" id="saveMsg"></div>' +
      '<div class="actions">' + (w ? '<button type="button" class="btn danger left" data-act="del-word">' + I.trash + 'Удалить</button>' : '') +
      '<button type="button" class="btn" data-act="modal-close">Отмена</button>' +
      (w ? '' : '<button type="button" class="btn" data-act="save-more">Сохранить и добавить ещё</button>') +
      '<button type="submit" class="btn primary" id="f-save">Сохранить</button></div></form>'
    );
    if (!w) { const e = $('#f-en'); if (e) e.focus(); } // сразу, без задержки: иначе фокус может «перехватить» уже начатый ввод в другом поле
  }
  function levelHTML(w) {
    if (!w) return '';
    const o = opts();
    const c = srs.cardOf(w);
    const due = srs.fmtDue(c, Date.now(), o);
    return '<div class="sect"><div class="sect-h">Уровень изучения</div><p class="muted small" style="margin-top:0">0 — слово ещё не изучено. 1–3 — повтор через 10 минут, 1 час, 6 часов; 4 — через сутки; дальше каждый уровень добавляет сутки. Уровень можно поменять вручную.</p>' +
      '<label class="lv-row">Уровень слова<span class="lv-in"><input type="number" id="lv-f" min="0" max="' + srs.maxLevel(srs.maxDaysOf(o)) + '" value="' + c.lv + '"><span class="muted small">' +
      (c.lv === 0 && !c.pend ? 'ещё не изучалось' : (due ? 'повтор: ' + due : '')) + '</span></span></label></div>';
  }
  function exHTML() {
    return form.ex.map((e, i) =>
      '<div class="ex-row" data-i="' + i + '"><input type="text" class="ex-en" lang="en" placeholder="Пример на английском" value="' + esc(e.en) + '">' +
      '<div class="ex-btns"><button type="button" class="icon-btn" data-act="ex-speak" data-i="' + i + '" aria-label="Произнести пример">' + I.speaker + '</button>' +
      '<button type="button" class="icon-btn" data-act="ex-del" data-i="' + i + '" aria-label="Убрать пример">' + I.trash + '</button></div>' +
      '<input type="text" class="ex-ru" placeholder="Перевод примера" value="' + esc(e.ru) + '"></div>').join('');
  }
  function syncExFromDom() {
    const rows = document.querySelectorAll('#exRows .ex-row');
    if (rows.length) form.ex = Array.from(rows).map((r) => ({ en: $('.ex-en', r).value, ru: $('.ex-ru', r).value }));
  }
  function attHTML() {
    let h = '';
    for (const fid of form.keep) {
      const f = core.get('files', fid);
      if (!f || f.d) continue;
      h += '<div class="file-chip"><button type="button" class="nm" data-act="open-file" data-id="' + esc(fid) + '">' + esc(f.name) + '</button><span class="muted small">' + fmtSize(f.size) +
        '</span><button type="button" class="icon-btn plain" data-act="att-del" data-id="' + esc(fid) + '" aria-label="Убрать файл">' + I.trash + '</button></div>';
    }
    form.pending.forEach((f, i) => {
      h += '<div class="file-chip"><span class="nm">' + esc(f.name) + ' <span class="muted small">(будет загружен)</span></span><span class="muted small">' + fmtSize(f.size) +
        '</span><button type="button" class="icon-btn plain" data-act="pend-del" data-i="' + i + '" aria-label="Убрать файл">' + I.trash + '</button></div>';
    });
    return h || '<div class="muted small" style="margin-bottom:8px">Файлов нет. Можно прикрепить картинку, аудио или видео.</div>';
  }
  function attPickHTML() {
    if (!M.signedIn) return '<div class="note info">Чтобы прикреплять файлы, войдите в Google (раздел «Ещё»). Файлы хранятся в вашем Google Drive.</div>';
    return '<button type="button" class="btn" data-act="att-pick">' + I.clip + 'Прикрепить файл</button><input type="file" id="f-files" multiple hidden>';
  }
  const normEn = (s) => csv.norm(s);
  function formDict() { const e = $('#f-dict'); return e ? e.value : form.dict; }
  function checkDup() {
    const en = $('#f-en');
    const box = $('#dup');
    if (!en || !box) return;
    const key = normEn(en.value);
    const d = key && wordsOfDict(formDict()).find((w) => normEn(w.en) === key && w.id !== form.id);
    box.hidden = !d;
    if (d) box.textContent = 'Такое слово уже есть' + (liveDicts().length > 1 ? ' в словаре «' + dictName(formDict()) + '»' : '') + ': «' + d.en + '» — ' + d.ru;
  }
  function showFormErr(msg) {
    const e = $('#f-err');
    if (!e) return;
    e.hidden = !msg; e.textContent = msg || '';
  }

  async function saveWord(addMore) {
    if (!form || form.busy) return;
    syncExFromDom();
    const en = $('#f-en').value.trim(), ru = $('#f-ru').value.trim();
    const tr = $('#f-tr').value.trim().replace(/^[\[\/]+/, '').replace(/[\]\/]+$/, '').trim();
    showFormErr('');
    if (!en) { showFormErr('Введите английское слово'); $('#f-en').focus(); return; }
    if (!ru) { showFormErr('Введите перевод'); $('#f-ru').focus(); return; }
    const dup = wordsOfDict(formDict()).find((w) => normEn(w.en) === normEn(en) && w.id !== form.id);
    if (dup && !window.confirm('Слово «' + dup.en + '» уже есть. Всё равно сохранить?')) return;
    const ex = form.ex.map((e) => ({ en: e.en.trim(), ru: e.ru.trim() })).filter((e) => e.en || e.ru);

    const newFiles = [];
    if (form.pending.length) {
      if (!M.signedIn) { showFormErr('Чтобы прикреплять файлы, войдите в Google'); return; }
      form.busy = true;
      $('#f-save').disabled = true;
      try {
        if (!D.tokenValid()) await D.getToken();
        for (let i = 0; i < form.pending.length; i++) {
          const f = form.pending[i];
          const msg = $('#saveMsg');
          const upd = (p) => { if (msg) msg.innerHTML = 'Загрузка файла ' + (i + 1) + ' из ' + form.pending.length + ': ' + Math.round(p * 100) + '%<div class="progress"><i style="width:' + Math.round(p * 100) + '%"></i></div>'; };
          upd(0);
          const r = await D.uploadAttachment(f, upd);
          const rec = core.upsert('files', { id: core.uid(), name: f.name, mime: f.type || 'application/octet-stream', size: f.size, driveId: r.driveId });
          newFiles.push(rec);
        }
      } catch (e) {
        for (const rec of newFiles) core.tomb('files', rec.id, { driveId: rec.driveId });
        if (newFiles.length) core.commit();
        form.busy = false;
        const b = $('#f-save'); if (b) b.disabled = false;
        const m = $('#saveMsg'); if (m) m.textContent = '';
        showFormErr('Не удалось загрузить файл: ' + (e.message || 'ошибка') + '. Слово не сохранено.');
        return;
      }
    }
    const now = Date.now();
    const old = form.id ? getWord(form.id) : null;
    const w = Object.assign({}, old || { id: core.uid(), c: now }, { en, ru, tr, ex, dict: formDict(), fl: form.keep.concat(newFiles.map((r) => r.id)) });
    // убранные вложения помечаем удалёнными (с driveId, чтобы стереть их на Drive)
    for (const fid of form.orig) {
      if (!form.keep.includes(fid)) { const f = core.get('files', fid); if (f && !f.d) core.tomb('files', fid, { driveId: f.driveId }); }
    }
    if (old) {
      const el = $('#lv-f');
      if (el && el.value !== '' && Math.round(+el.value) !== srs.cardOf(old).lv) { w.f = srs.setLevel(srs.cardOf(old), +el.value, now, opts()); delete w.b; }
    }
    core.upsert('words', w);
    core.commit();
    form.busy = false;
    closeModal();
    toast(old ? 'Сохранено' : 'Слово добавлено');
    if (addMore) openWordForm();
  }
  function deleteWord() {
    if (!form || !form.id) return;
    const w = getWord(form.id);
    if (!w) return;
    if (!window.confirm('Удалить слово «' + w.en + '»?')) return;
    for (const fid of w.fl || []) { const f = core.get('files', fid); if (f && !f.d) core.tomb('files', fid, { driveId: f.driveId }); }
    core.tomb('words', w.id);
    core.commit();
    closeModal();
    toast('Слово удалено');
  }

  /* ---------- файлы ---------- */
  async function openFile(id) {
    const rec = core.get('files', id);
    if (!rec || rec.d) return;
    closeViewer();
    $('#viewer-root').innerHTML = '<div class="overlay" data-act="viewer-bg"><div class="sheet wide" role="dialog" aria-modal="true"><h2>' + esc(rec.name) + '</h2><div class="viewer" id="viewer"><div class="muted">Загрузка…</div><div class="progress"><i id="vp"></i></div></div><div class="actions"><button class="btn" data-act="viewer-close">Закрыть</button></div></div></div>';
    try {
      const blob = await D.getFileBlob(rec, (p) => { const e = $('#vp'); if (e) e.style.width = Math.round(p * 100) + '%'; });
      if (!$('#viewer')) return;
      viewerUrl = URL.createObjectURL(blob);
      const m = (rec.mime || blob.type || '').toLowerCase();
      let h;
      if (m.startsWith('image/')) h = '<img src="' + viewerUrl + '" alt="' + esc(rec.name) + '">';
      else if (m.startsWith('audio/')) h = '<audio controls autoplay src="' + viewerUrl + '"></audio>';
      else if (m.startsWith('video/')) h = '<video controls playsinline src="' + viewerUrl + '"></video>';
      else if (m === 'application/pdf') h = '<iframe src="' + viewerUrl + '" title="' + esc(rec.name) + '"></iframe>';
      else h = '<div class="muted">Предпросмотр недоступен.</div>';
      h += '<div class="row wrap" style="justify-content:center;margin-top:12px"><a class="btn" href="' + viewerUrl + '" download="' + esc(rec.name) + '">Скачать (' + fmtSize(rec.size) + ')</a>';
      if (blob.size > D.AUTO_CACHE_MAX && !(await D.isCached(rec))) h += '<button class="btn" data-act="cache-file" data-id="' + esc(id) + '">Хранить на устройстве</button>';
      h += '</div>';
      $('#viewer').innerHTML = h;
    } catch (e) {
      const v = $('#viewer');
      if (v) v.innerHTML = '<div class="note err">' + esc(e.message || 'Не удалось открыть файл') + '</div>';
    }
  }
  async function cacheFile(id) {
    const rec = core.get('files', id);
    if (!rec) return;
    try { const blob = await D.getFileBlob(rec, null, true); await D.cacheFile(rec, blob); toast('Файл сохранён на устройстве'); } catch (e) { toast(e.message || 'Не удалось сохранить'); }
  }

  /* ---------- импорт CSV ---------- */
  function openImport() {
    imp = { parsed: null };
    openModal(
      '<h2>Импорт слов из CSV</h2>' +
      '<p class="muted small">Колонки: <b>en, ru, transcription, example_en, example_ru</b>. Первая строка — заголовок (необязательно). Подходят разделители «;», «,» и табуляция, кодировка UTF-8 или Windows-1251. Несколько примеров в одной ячейке разделяйте « | ».</p>' +
      '<label>В какой словарь<select id="imp-dict">' + dictOptions(curId() === 'all' ? core.dictId({}) : curId()) + '<option value="__new">＋ Новый словарь…</option></select></label>' +
      '<label id="imp-newwrap" hidden>Название нового словаря<input type="text" id="imp-newname" maxlength="40" autocomplete="off"></label>' +
      '<div class="row wrap" style="margin-bottom:12px"><button class="btn primary" data-act="imp-pick">Выбрать файл</button><button class="btn" data-act="tpl">Скачать образец</button></div>' +
      '<input type="file" id="imp-file" accept=".csv,.txt,text/csv,text/plain" hidden>' +
      '<div class="sect"><div class="sect-h">Или вставьте текст</div><textarea id="imp-text" placeholder="apple;яблоко;ˈæp.əl;I eat an apple.;Я ем яблоко."></textarea><div style="margin-top:8px"><button class="btn" data-act="imp-parse">Проверить</button></div></div>' +
      '<div id="imp-prev"></div><div class="actions"><button class="btn" data-act="modal-close">Закрыть</button></div>', 'wide'
    );
  }
  const impDict = () => { const e = $('#imp-dict'); return e ? e.value : ''; };
  function parseImport(text) {
    imp.parsed = csv.parse(text);
    previewImport();
  }
  function previewImport() {
    const p = imp && imp.parsed;
    if (!p) return;
    const tgt = impDict();
    const map = new Map(tgt === '__new' ? [] : wordsOfDict(tgt).map((w) => [normEn(w.en), w]));
    const dups = p.rows.filter((r) => map.has(normEn(r.en))).length;
    imp.dups = dups;
    let h = '';
    if (!p.rows.length) {
      h = '<div class="note err">Не нашёл ни одной строки со словом и переводом.' + (p.errors.length ? ' Например: ' + esc(p.errors[0].msg) : '') + '</div>';
    } else {
      h += '<div class="note info">Найдено слов: <b>' + p.rows.length + '</b> (новых: ' + (p.rows.length - dups) + ', уже есть' + (liveDicts().length > 1 && tgt !== '__new' ? ' в словаре «' + esc(dictName(tgt)) + '»' : '') + ': ' + dups + ')' + (p.errors.length ? ', пропущено строк с ошибками: ' + p.errors.length : '') +
        (p.swappedRows ? '. В строках, где русский и английский были наоборот, поменял их местами: ' + p.swappedRows : '') + '.</div>';
      h += '<table class="prev"><tr><th>Английский</th><th>Транскрипция</th><th>Русский</th></tr>' +
        p.rows.slice(0, 6).map((r) => '<tr><td>' + esc(r.en) + '</td><td>' + esc(r.tr) + '</td><td>' + esc(r.ru) + '</td></tr>').join('') + '</table>';
      if (p.rows.length > 6) h += '<div class="muted small" style="margin-bottom:8px">…и ещё ' + (p.rows.length - 6) + '</div>';
      if (dups) h += '<label>Если слово уже есть<select id="imp-mode"><option value="skip">Пропустить</option><option value="update">Обновить перевод, транскрипцию и примеры (прогресс сохранится)</option></select></label>';
      h += '<button class="btn primary" data-act="imp-do">Импортировать ' + p.rows.length + '</button>';
    }
    if (p.errors.length) h += '<details style="margin-top:12px"><summary class="muted small">Строки с ошибками (' + p.errors.length + ')</summary><div class="small muted">' + p.errors.slice(0, 15).map((e) => 'Строка ' + e.line + ': ' + esc(e.msg)).join('<br>') + (p.errors.length > 15 ? '<br>…' : '') + '</div></details>';
    $('#imp-prev').innerHTML = h;
  }
  function doImport() {
    if (!imp || !imp.parsed) return;
    const modeEl = $('#imp-mode');
    const mode = modeEl ? modeEl.value : 'skip';
    const now = Date.now();
    let tgt = impDict();
    if (tgt === '__new') {
      const name = $('#imp-newname').value.trim();
      const err = dictNameError(name);
      if (err) { toast(err); $('#imp-newname').focus(); return; }
      tgt = core.upsert('dicts', { id: core.uid(), name, c: now }).id;
    }
    const map = new Map(wordsOfDict(tgt).map((w) => [normEn(w.en), w]));
    let added = 0, updated = 0, skipped = 0;
    imp.parsed.rows.forEach((r, i) => {
      const ex = map.get(normEn(r.en));
      if (!ex) {
        const w = { id: core.uid(), en: r.en, ru: r.ru, tr: r.tr, ex: r.ex, fl: [], dict: tgt, c: now + i / 1000, u: now };
        core.S.words.push(w);
        map.set(normEn(r.en), w);
        added++;
      } else if (mode === 'update') {
        ex.ru = r.ru;
        if (r.tr) ex.tr = r.tr;
        if (r.ex.length) ex.ex = r.ex;
        ex.u = now;
        updated++;
      } else skipped++;
    });
    if (tgt !== curId() && curId() !== 'all') setCur(tgt);
    core.commit();
    closeModal();
    toast('Добавлено: ' + added + (updated ? ', обновлено: ' + updated : '') + (skipped ? ', пропущено: ' + skipped : ''));
  }

  /* ---------- занятие ---------- */
  // Окно «Изучить новые слова сегодня»: сверх дневного лимита
  function openMoreNew() {
    const st = srs.stats(scopeWords(), opts());
    if (!st.newEligible) { toast('Новых слов в этом словаре больше нет'); return; }
    const max = st.newEligible, def = Math.min(max, Math.max(1, PR().newPerDay || 10));
    openModal('<h2>Изучить новые слова сегодня</h2><p class="muted small" style="margin-top:0">Дневной лимит новых слов уже выбран. Сколько ещё слов выучить сегодня? Они выбираются случайно из словаря. Всего ещё не начато: ' + max + '.</p>' +
      '<form id="mnf" autocomplete="off" novalidate><label>Количество слов<input type="number" id="mn-n" min="1" max="' + max + '" value="' + def + '" inputmode="numeric"></label>' +
      '<div class="row wrap" style="margin-bottom:8px">' + [5, 10, 20, 50].filter((n) => n < max).map((n) => '<button type="button" class="btn" data-act="mn-set" data-n="' + n + '">' + n + '</button>').join('') + '<button type="button" class="btn" data-act="mn-set" data-n="' + max + '">Все (' + max + ')</button></div>' +
      '<div class="note err" id="mn-err" hidden></div>' +
      '<div class="actions"><button type="button" class="btn" data-act="modal-close">Отмена</button><button type="submit" class="btn primary">Начать</button></div></form>');
    const e = $('#mn-n'); if (e) { e.focus(); e.select(); }
  }
  function startMoreNew() {
    const st = srs.stats(scopeWords(), opts());
    const n = Math.round(+$('#mn-n').value);
    if (!(n >= 1)) { const e = $('#mn-err'); e.hidden = false; e.textContent = 'Введите число от 1 до ' + st.newEligible; return; }
    closeModal();
    startStudy('new', Math.min(n, st.newEligible));
  }
  function startStudy(mode, extra) {
    const dict = curId();
    const q = srs.buildQueue(inScope(dict), Object.assign({ mode, extraNew: extra }, opts()));
    study = { mode, ws: {}, done: 0, correct: 0, cur: null, revealed: false, last: null, dict, queue: q.items };
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    document.body.classList.add('noscroll');
    nextCard();
  }
  function nextCard() {
    while (study.queue.length && !getWord(study.queue[0].id)) study.queue.shift();
    study.cur = study.queue.length ? Object.assign({}, study.queue[0]) : null;
    study.revealed = false;
    renderStudy();
    if (study.cur && study.cur.k === 'f' && PR().autoSpeak) speakText(getWord(study.cur.id).en);
  }
  function reveal() {
    if (!study || !study.cur || study.revealed) return;
    study.revealed = true;
    renderStudy();
    const w = getWord(study.cur.id);
    if (w && study.cur.k === 'b' && PR().autoSpeak) speakText(w.en);
  }
  // Состояние слова в этом занятии: сколько ошибок и в каких направлениях уже верно
  function wsOf(id, w) {
    if (!study.ws[id]) { const c = srs.cardOf(w); study.ws[id] = { miss: c.pend ? c.miss : 0, right: {}, fresh: c.lv === 0 && !c.pend }; }
    return study.ws[id];
  }
  // know: true — «знаю», false — «не знаю». Слово засчитывается, когда верно во всех включённых направлениях.
  function grade(know) {
    if (!study || !study.cur || !study.revealed) return;
    const cur = study.cur;
    const w = getWord(cur.id);
    if (!w) { nextCard(); return; }
    const now = Date.now();
    const D = srs.dirsOf(opts().dirs);
    const prev = { f: w.f == null ? null : JSON.parse(JSON.stringify(w.f)), b: w.b == null ? null : JSON.parse(JSON.stringify(w.b)) };
    const queueBefore = study.queue.map((x) => Object.assign({}, x));
    const wsBefore = JSON.parse(JSON.stringify(study.ws[w.id] || null));
    const ws = wsOf(w.id, w);
    if (know) ws.right[cur.k] = true; else { ws.miss++; ws.right[cur.k] = false; }
    w.u = now;
    const dayId = 'd' + srs.dayNum();
    const day = core.get('days', dayId) || { id: dayId, n: 0, c: 0 };
    day.n++;
    if (know) day.c++;
    core.upsert('days', day);
    study.queue.shift();
    if (!know) {
      // «не знаю»: это направление вернётся через несколько карточек, пока не ответят «знаю»
      w.f = srs.failed(w.f != null ? w.f : w.b, ws.miss, now); delete w.b;
      srs.insertCards(study.queue, [{ id: w.id, k: cur.k, kind: 'learn' }], null, 9);
    } else if (D.every((d) => ws.right[d])) {
      const wasNew = ws.fresh && ws.miss === 0;
      w.f = srs.finish(w.f != null ? w.f : w.b, ws.miss, now, opts()); delete w.b;
      if (wasNew) {
        // новое слово оказалось знакомым — в занятие добавляется ещё одно новое
        const inQ = new Set(study.queue.map((x) => x.id));
        const more = srs.nextNew(inScope(study.dict), opts(), inQ);
        if (more) srs.insertCards(study.queue, more);
      }
    } else {
      // осталось другое направление: если его нет в очереди (настройки поменяли посреди занятия), добавляем
      for (const d of D) if (!ws.right[d] && !study.queue.some((x) => x.id === w.id && x.k === d)) srs.insertCards(study.queue, [{ id: w.id, k: d, kind: cur.kind }], null, 9);
    }
    study.last = { id: w.id, prev, queue: queueBefore, ws: wsBefore, dayId, good: know, cur };
    study.done++;
    if (know) study.correct++;
    core.commit();
    nextCard();
  }
  function undo() {
    if (!study || !study.last) return;
    const l = study.last;
    const w = getWord(l.id);
    if (w) {
      for (const k of ['f', 'b']) { if (l.prev[k]) w[k] = l.prev[k]; else delete w[k]; }
      w.u = Date.now();
      if (l.ws) study.ws[l.id] = l.ws; else delete study.ws[l.id];
    }
    const day = core.get('days', l.dayId);
    if (day) { day.n = Math.max(0, day.n - 1); if (l.good) day.c = Math.max(0, day.c - 1); core.upsert('days', day); }
    study.done = Math.max(0, study.done - 1);
    if (l.good) study.correct = Math.max(0, study.correct - 1);
    study.queue = l.queue;
    study.last = null;
    core.commit();
    study.cur = study.queue.length ? Object.assign({}, study.queue[0]) : null;
    study.revealed = false;
    renderStudy();
  }
  function closeStudy() {
    study = null;
    tts.stop();
    $('#study-root').innerHTML = '';
    if (!$('#modal-root').innerHTML) document.body.classList.remove('noscroll');
    render();
  }
  function renderStudy() {
    const root = $('#study-root');
    if (!study) { root.innerHTML = ''; return; }
    const cur = study.cur;
    let body = '', actions = '', left = 0;
    if (!cur) {
      body = '<div class="done"><h2>' + (study.done ? 'Занятие завершено' : 'Пока нечего повторять') + '</h2><p class="muted">' +
        (study.done ? 'Пройдено карточек: ' + study.done + ', верно: ' + study.correct + '.' : 'Новые карточки появятся по расписанию.') + '</p><button class="btn primary" data-act="study-close" style="margin-top:12px">Готово</button></div>';
    } else {
      const w = getWord(cur.id);
      const f = cur.k === 'f';
      left = study.queue.length;
      const lvNow = srs.cardOf(w).lv;
      const kind = (f ? 'Английский → русский' : 'Русский → английский') + (cur.kind === 'new' ? ' <span class="badge new">новое</span>' : '') + (cur.kind === 'learn' ? ' <span class="badge due">ещё раз</span>' : '') + (lvNow ? ' <span class="badge lvl">ур. ' + lvNow + '</span>' : '');
      body = '<div class="st-card"><div class="st-kind">' + kind + '</div>';
      if (f) body += '<div class="st-line"><div class="st-word" lang="en">' + esc(w.en) + '</div><button class="icon-btn" data-act="speak" data-text="' + esc(w.en) + '" aria-label="Произнести">' + I.speaker + '</button></div>';
      else body += '<div class="st-word" lang="ru">' + esc(w.ru) + '</div>';
      if (study.revealed) {
        body += '<div class="st-sep"></div>';
        if (f) body += '<div class="st-ans" lang="ru">' + esc(w.ru) + '</div>' + (w.tr ? '<div class="st-tr">[' + esc(w.tr) + ']</div>' : '');
        else body += '<div class="st-line"><div class="st-ans" lang="en">' + esc(w.en) + '</div><button class="icon-btn" data-act="speak" data-text="' + esc(w.en) + '" aria-label="Произнести">' + I.speaker + '</button></div>' + (w.tr ? '<div class="st-tr">[' + esc(w.tr) + ']</div>' : '');
        const exs = (w.ex || []).filter((e) => e.en || e.ru);
        if (exs.length) body += '<div class="st-ex">' + exs.map((e) => '<div><div class="en"><span lang="en">' + esc(e.en) + '</span>' + (e.en ? '<button class="icon-btn plain" style="width:36px;height:36px" data-act="speak" data-text="' + esc(e.en) + '" aria-label="Произнести пример">' + I.speaker + '</button>' : '') + '</div>' + (e.ru ? '<div class="ru">' + esc(e.ru) + '</div>' : '') + '</div>').join('') + '</div>';
        const fl = (w.fl || []).map((id) => core.get('files', id)).filter((x) => x && !x.d);
        if (fl.length) body += '<div class="st-files">' + fl.map((x) => '<button class="btn" data-act="open-file" data-id="' + esc(x.id) + '">' + I.clip + esc(x.name.length > 22 ? x.name.slice(0, 20) + '…' : x.name) + '</button>').join('') + '</div>';
      }
      body += '</div>';
      if (!study.revealed) actions = '<button class="btn primary big" data-act="reveal">Показать ответ</button>';
      else {
        const wst = wsOf(w.id, w);
        const more = srs.dirsOf(opts().dirs).some((d) => d !== cur.k && !wst.right[d]);
        const pv = srs.preview(srs.cardOf(w), wst.miss, more, Date.now(), opts());
        actions = '<div class="grades two"><button class="grade g0" data-act="grade" data-know="0">Не знаю<small>' + esc(pv.no) + '</small></button>' +
          '<button class="grade g2" data-act="grade" data-know="1">Знаю<small>' + esc(pv.yes) + '</small></button></div>';
      }
    }
    root.innerHTML = '<div class="study" role="dialog" aria-label="Занятие"><div class="st-top"><button class="icon-btn plain" data-act="study-close" aria-label="Закрыть">' + I.close + '</button>' +
      '<div class="st-prog">' + (liveDicts().length > 1 ? '<span class="muted">' + esc(scopeLabel(study.dict)) + '</span> · ' : '') + (cur ? 'Осталось: <b>' + left + '</b>' : '') + '</div><button class="icon-btn plain" data-act="undo" aria-label="Отменить последний ответ"' + (study.last ? '' : ' disabled style="opacity:.35"') + '>' + I.undo + '</button></div>' +
      '<div class="st-body">' + body + '</div>' + (actions ? '<div class="st-actions">' + actions + '</div>' : '') + '</div>';
  }

  /* ---------- настройки ---------- */
  function syncCardHTML() {
    if (!M.signedIn) {
      return '<h3>Синхронизация</h3><p class="muted small" style="margin-top:0">Сейчас слова хранятся только на этом устройстве. Войдите в Google, чтобы они появились на других устройствах и можно было прикреплять файлы. Данные лежат в скрытой папке приложения на вашем Google Drive; разработчик их не видит. Вход необязателен.</p>' +
        '<button class="btn primary" data-act="signin">Войти через Google</button>';
    }
    const st = D.status;
    const last = M.lastSync ? new Date(M.lastSync).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'ещё не было';
    let line = 'Последняя синхронизация: ' + last;
    if (st.k === 'sync') line = 'Синхронизация…';
    if (st.k === 'authneeded' || st.k === 'offline' || st.k === 'error') line = st.msg || line;
    return '<h3>Синхронизация</h3><p class="' + (st.k === 'ok' || st.k === 'sync' ? 'muted' : 'note') + ' small" style="margin-top:0">' + esc(line) + '</p>' +
      '<div class="row wrap"><button class="btn primary" data-act="sync">Синхронизировать</button><button class="btn" data-act="signout">Выйти</button></div>';
  }
  function renderSettings() {
    view.dataset.tab = 'settings';
    const s = S().settings;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;
    view.innerHTML =
      '<div class="card" id="syncCard">' + syncCardHTML() + '</div>' +
      (installEvt ? '<div class="card"><h3>Приложение</h3><p class="muted small" style="margin-top:0">Установите English Words на устройство: откроется как обычное приложение и будет работать без интернета.</p><button class="btn primary" data-act="install">Установить</button></div>' : '') +
      (ios ? '<div class="card"><h3>Установка на iPhone</h3><p class="muted small" style="margin:0">В Safari нажмите «Поделиться» и выберите «На экран Домой». Так приложение откроется отдельно и данные надёжнее сохранятся.</p></div>' : '') +
      '<div class="card"><h3>Занятия</h3><p class="muted small" style="margin-top:0">Все настройки приложения переносятся на другие ваши устройства, если вы вошли в Google.</p>' +
      '<label>Новых слов в день<input type="number" id="s-new" min="0" max="500" value="' + s.newPerDay + '"></label>' +
      '<label>Максимальный интервал повторения, суток<input type="number" id="s-max" min="2" max="3650" value="' + s.maxDays + '"></label>' +
      '<p class="muted small" style="margin-top:-4px">Повторения идут через 10 минут, 1 час, 6 часов, 1, 2, 3 суток и так далее, каждый раз на сутки дольше, но не больше этого числа. Слово, о котором сразу ответили «знаю», в дневной лимит новых не входит.</p>' +
      '<label class="check"><input type="checkbox" id="s-df"' + (s.dirs.f ? ' checked' : '') + '>Английский → русский</label>' +
      '<label class="check"><input type="checkbox" id="s-db"' + (s.dirs.b ? ' checked' : '') + '>Русский → английский</label>' +
      '<p class="muted small" style="margin:0">Если включены оба направления, слово засчитывается, когда вы ответили «знаю» в обе стороны. Направление, в котором ошиблись, повторяется в этом же занятии. Была хоть одна ошибка — уровень слова не растёт.</p></div>' +
      '<div class="card"><h3>Произношение</h3><p class="muted small" style="margin-top:0">Настройки переносятся между устройствами. Сами голоса берутся из устройства, поэтому на телефоне и компьютере они могут отличаться: если выбранного голоса нет, подберётся подходящий.</p>' +
      (tts.supported ? '' : '<div class="note err">Этот браузер не умеет озвучивать текст.</div>') +
      '<label>Акцент<select id="s-accent"><option value="en-US">Американский</option><option value="en-GB">Британский</option></select></label>' +
      '<label>Голос<select id="s-voice"></select></label>' +
      '<label>Скорость: <span id="rate-v">' + PR().rate.toFixed(2).replace('.', ',') + '</span><input type="range" id="s-rate" min="0.5" max="1.2" step="0.05" value="' + PR().rate + '"></label>' +
      '<label class="check"><input type="checkbox" id="s-auto"' + (PR().autoSpeak ? ' checked' : '') + '>Произносить слово автоматически</label>' +
      '<button class="btn" data-act="speak" data-text="Hello! This is how I pronounce English words.">' + I.speaker + 'Проверить голос</button></div>' +
      '<div class="card" id="dataCard"></div>' +
      '<div class="card"><h3>О приложении</h3><p class="muted small" style="margin:0">English Words · версия 2.0 · <a href="privacy.html">политика конфиденциальности</a></p></div>';
    $('#s-accent').value = PR().accent;
    fillVoices();
    refreshData();
  }
  function fillVoices() {
    const sel = $('#s-voice');
    if (!sel) return;
    const list = tts.list();
    sel.innerHTML = '<option value="">Подобрать автоматически</option>' + list.map((v) => '<option value="' + esc(v.voiceURI) + '">' + esc(v.name + ' (' + v.lang + ')') + '</option>').join('');
    sel.value = PR().voice && list.some((v) => v.voiceURI === PR().voice) ? PR().voice : '';
  }
  async function refreshData() {
    const el = $('#dataCard');
    if (!el) return;
    const words = liveWords().length;
    const files = core.live('files').length;
    let extra = '';
    try {
      const st = await core.blobStats();
      extra += '<div class="muted small">Файлов сохранено на устройстве: ' + st.n + ' (' + fmtSize(st.size) + ')</div>';
      if (navigator.storage && navigator.storage.persisted) {
        const p = await navigator.storage.persisted();
        extra += '<div class="muted small">Защита хранилища от очистки браузером: ' + (p ? 'включена' : 'не включена') + '</div>';
      }
    } catch (e) { /* ignore */ }
    if ($('#dataCard') !== el) return;
    el.innerHTML = '<h3>Данные</h3><div class="muted small" style="margin-bottom:8px">Слов: ' + words + ' · словарей: ' + core.live('dicts').length + ' · вложений: ' + files + '</div>' + extra +
      '<div class="row wrap" style="margin-top:12px"><button class="btn" data-act="export">Экспорт CSV</button><button class="btn" data-act="tpl">Образец CSV</button><button class="btn" data-act="clear-files">Очистить файлы на устройстве</button></div>' +
      '<div style="margin-top:12px"><button class="btn danger" data-act="wipe">Стереть данные на этом устройстве</button></div>';
  }
  async function wipeLocal() {
    if (!window.confirm('Стереть все слова, прогресс и файлы на этом устройстве?' + (M.signedIn ? ' Копия на Google Drive останется и вернётся при следующей синхронизации.' : ' Без входа в Google их нельзя будет вернуть.'))) return;
    core.S = core.normalize(core.defaults());
    M.dirty = false; M.rv = ''; M.lastSync = 0;
    core.saveMeta();
    await core.persist(true);
    await core.blobClear().catch(() => {});
    toast('Данные стёрты');
    show('study');
  }

  /* ---------- словари: управление, слияние, проверка повторов ---------- */
  function openDicts() {
    dm = { v: 'list', edit: '', src: '', dst: '', pol: 'target' };
    openModal('', 'wide');
    renderDm();
  }
  function renderDm() {
    const sh = $('#modal-root .sheet');
    if (!sh || !dm) return;
    sh.innerHTML = dm.v === 'merge' ? mergeHTML() : dm.v === 'check' ? checkHTML() : dm.v === 'shared' ? sharedHTML() : dictsListHTML();
  }
  const wordsWord = (n) => { const a = n % 100, b = n % 10; return n + ' ' + (a > 10 && a < 15 ? 'слов' : b === 1 ? 'слово' : b > 1 && b < 5 ? 'слова' : 'слов'); };
  function progHTML(wordsOf) {
    const p = srs.progress(wordsOf);
    if (!p.total) return '';
    const pc = (x) => Math.round((x / p.total) * 100);
    return '<div class="prog" title="Начато — слово уже показывали. Изучено — повторение уже раз в 3 недели и реже."><div class="pbar"><i class="p1" style="width:' + pc(p.started) + '%"></i><i class="p2" style="width:' + pc(p.learned) + '%"></i></div>' +
      '<div class="muted small">Начато: <b>' + pc(p.started) + '%</b> (' + p.started + ' из ' + p.total + ') · Изучено: <b>' + pc(p.learned) + '%</b> (' + p.learned + ')</div></div>';
  }
  function dictsListHTML() {
    const ds = liveDicts(), n = dictCounts(), cur = curId(), res = core.dictResolver(), lw = liveWords();
    const rows = ds.map((d) => {
      if (dm.edit === d.id) {
        return '<form class="di" id="dm-renf" data-id="' + esc(d.id) + '" autocomplete="off"><input type="text" id="dm-ren" class="grow" maxlength="40" value="' + esc(d.name) + '"><button class="btn primary" type="submit">Сохранить</button><button type="button" class="btn" data-act="dm-ren-cancel">Отмена</button></form>';
      }
      return '<div class="di"><div class="di-main"><div class="di-name">' + esc(d.name) + (d.id === cur ? '<span class="badge new">выбран</span>' : '') + '</div><div class="muted small">' + wordsWord(n[d.id] || 0) + '</div>' + progHTML(lw.filter((w) => res(w) === d.id)) + '</div>' +
        '<div class="di-btns">' + (d.id === cur ? '' : '<button type="button" class="btn" data-act="dm-pick" data-id="' + esc(d.id) + '">Открыть</button>') +
        '<button type="button" class="btn" data-act="dm-ren" data-id="' + esc(d.id) + '">Переименовать</button>' +
        '<button type="button" class="btn" data-act="dm-reset" data-id="' + esc(d.id) + '">Сбросить прогресс</button>' +
        (ds.length > 1 ? '<button type="button" class="btn" data-act="dm-mergefrom" data-id="' + esc(d.id) + '">Слить в…</button>' : '') +
        '<button type="button" class="btn danger" data-act="dm-del" data-id="' + esc(d.id) + '"' + (ds.length > 1 ? '' : ' disabled') + '>' + I.trash + 'Удалить</button></div></div>';
    }).join('');
    return '<h2>Словари</h2><p class="muted small" style="margin-top:0">Занятия, повторения и список слов показывают только выбранный словарь. Одно и то же слово может быть в разных словарях.</p>' +
      '<form class="row" id="dmf" autocomplete="off" style="margin-bottom:12px"><input type="text" id="dm-new" class="grow" maxlength="40" placeholder="Название нового словаря"><button class="btn primary" type="submit">Создать</button></form>' +
      '<div class="note err" id="dm-err" hidden></div><div class="dlist">' + rows + '</div>' +
      '<div class="row wrap" style="margin-top:12px"><button type="button" class="btn" data-act="dm-merge"' + (ds.length > 1 ? '' : ' disabled') + '>Слить словари…</button><button type="button" class="btn" data-act="dm-check">Проверить повторы</button><button type="button" class="btn" data-act="dm-shared">Добавить готовый</button></div>' +
      '<div class="actions"><button type="button" class="btn" data-act="modal-close">Закрыть</button></div>';
  }
  function dmErr(msg) { const e = $('#dm-err'); if (e) { e.hidden = !msg; e.textContent = msg || ''; } }

  function createDict(name) {
    name = name.trim();
    const err = dictNameError(name);
    if (err) { dmErr(err); return; }
    const d = core.upsert('dicts', { id: core.uid(), name, c: Date.now() });
    setCur(d.id);
    core.commit();
    dm.edit = '';
    renderDm();
    toast('Словарь «' + name + '» создан и выбран');
  }
  function renameDict(id, name) {
    name = name.trim();
    const err = dictNameError(name, id);
    if (err) { dmErr(err); return; }
    const d = core.get('dicts', id);
    if (!d || d.d) return;
    core.upsert('dicts', Object.assign({}, d, { name }));
    core.commit();
    dm.edit = '';
    renderDm();
  }
  function deleteDict(id) {
    const ds = liveDicts();
    const d = core.get('dicts', id);
    if (!d || d.d || ds.length < 2) return;
    const ws = wordsOfDict(id);
    if (!window.confirm('Удалить словарь «' + d.name + '»' + (ws.length ? ' вместе с его словами (' + ws.length + ')' : '') + '? Слова можно сначала перенести в другой словарь через «Слить в…».')) return;
    for (const w of ws) {
      for (const fid of w.fl || []) { const f = core.get('files', fid); if (f && !f.d) core.tomb('files', fid, { driveId: f.driveId }); }
      core.tomb('words', w.id);
    }
    core.tomb('dicts', id);
    if (PR().cur === id) setCur('');
    core.commit();
    renderDm();
    toast('Словарь удалён');
  }

  // Сброс прогресса: все слова словаря снова становятся новыми (уровень 0). Сами слова, примеры и файлы остаются.
  function resetDict(id) {
    const d = core.get('dicts', id);
    if (!d || d.d) return;
    const ws = wordsOfDict(id);
    const started = ws.filter((w) => w.f || w.b);
    if (!started.length) { toast('В словаре «' + d.name + '» прогресса нет'); return; }
    if (!window.confirm('Сбросить прогресс в словаре «' + d.name + '»? У ' + started.length + ' слов уровень изучения станет нулевым, и они будут изучаться заново. Сами слова останутся. Отменить это будет нельзя.')) return;
    const now = Date.now();
    for (const w of started) { delete w.f; delete w.b; w.u = now; }
    core.commit();
    renderDm();
    toast('Прогресс сброшен: ' + started.length + ' слов');
  }
  const unionIds = (a, b) => Array.from(new Set((a || []).concat(b || [])));
  function unionEx(a, b) {
    const out = (a || []).slice();
    const key = (e) => normEn(e.en) + '|' + normEn(e.ru);
    const seen = new Set(out.map(key));
    for (const e of b || []) if (!seen.has(key(e))) { seen.add(key(e)); out.push(e); }
    return out;
  }
  /*
   * Слияние: слова из src переносятся в dst. Повторы ищутся по английскому слову (без учёта регистра).
   * pol: 'target' — остаётся слово из dst (к нему добавляются примеры и файлы, сохраняется лучший прогресс),
   *      'source' — слово из dst заменяется словом из src, 'both' — повторы не объединяются.
   * dry = true — только подсчёт, данные не меняются.
   */
  function runMerge(src, dst, pol, dry) {
    const now = Date.now();
    const r = core.dictResolver();
    const all = liveWords();
    const rep = new Map();
    for (const w of all) if (r(w) === dst) { const k = normEn(w.en); if (!rep.has(k)) rep.set(k, w); }
    const res = { src: 0, moved: 0, merged: 0, replaced: 0, dups: [] };
    for (const s of all.filter((w) => r(w) === src)) {
      res.src++;
      const k = normEn(s.en);
      const t = pol === 'both' ? null : rep.get(k);
      if (!t) {
        if (!dry) { s.dict = dst; s.u = now; }
        if (pol !== 'both') rep.set(k, s);
        res.moved++;
        continue;
      }
      if (res.dups.length < 200) res.dups.push({ en: s.en, s: s.ru, t: t.ru, same: normEn(s.ru) === normEn(t.ru) });
      if (pol === 'source') {
        if (!dry) { s.dict = dst; s.fl = unionIds(s.fl, t.fl); s.u = now; core.tomb('words', t.id); }
        rep.set(k, s);
        res.replaced++;
      } else {
        if (!dry) {
          t.ex = unionEx(t.ex, s.ex);
          t.fl = unionIds(t.fl, s.fl);
          if (!t.tr && s.tr) t.tr = s.tr;
          { const sc = srs.cardOf(s), tc = srs.cardOf(t); if ((sc.lv > 0 || sc.pend) && sc.lv > tc.lv) { t.f = sc; delete t.b; } }
          t.u = now;
          core.tomb('words', s.id);
        }
        res.merged++;
      }
    }
    return res;
  }
  function mergeHTML() {
    const ds = liveDicts();
    if (!dm.src || !ds.some((d) => d.id === dm.src)) dm.src = curId() === 'all' ? ds[0].id : curId();
    if (!dm.dst || dm.dst === dm.src || !ds.some((d) => d.id === dm.dst)) dm.dst = (ds.find((d) => d.id !== dm.src) || ds[0]).id;
    const pv = runMerge(dm.src, dm.dst, dm.pol, true);
    const sel = (id, cur, skip) => ds.filter((d) => d.id !== skip).map((d) => '<option value="' + esc(d.id) + '"' + (d.id === cur ? ' selected' : '') + '>' + esc(d.name) + '</option>').join('');
    let prev = '<div class="note info">В «' + esc(dictName(dm.src)) + '»: ' + wordsWord(pv.src) + '. Перенесётся новых: <b>' + pv.moved + '</b>. Повторов с «' + esc(dictName(dm.dst)) + '»: <b>' + (dm.pol === 'both' ? 0 : pv.merged + pv.replaced) + '</b>' +
      (dm.pol === 'both' ? ' (повторы не проверяются)' : '') + '.</div>';
    if (pv.dups.length && dm.pol !== 'both') {
      prev += '<details open class="dups"><summary class="muted small">Повторы (' + pv.dups.length + ')</summary><div class="small">' +
        pv.dups.slice(0, 12).map((d) => '<div class="dg"><b>' + esc(d.en) + '</b> — ' + (d.same ? esc(d.s) : esc(d.s) + ' <span class="muted">/ в «' + esc(dictName(dm.dst)) + '»: ' + esc(d.t) + '</span>') + '</div>').join('') +
        (pv.dups.length > 12 ? '<div class="muted">…и ещё ' + (pv.dups.length - 12) + '</div>' : '') + '</div></details>';
    }
    return '<h2>Слить словари</h2><p class="muted small" style="margin-top:0">Слова из первого словаря переносятся во второй, повторы (по английскому слову) проверяются. Первый словарь после этого удаляется.</p>' +
      '<label>Из словаря<select id="mg-src">' + sel('', dm.src, '') + '</select></label>' +
      '<label>В словарь<select id="mg-dst">' + sel('', dm.dst, dm.src) + '</select></label>' +
      '<label>Если слово есть в обоих словарях<select id="mg-pol">' +
      '<option value="target"' + (dm.pol === 'target' ? ' selected' : '') + '>Оставить слово из второго словаря</option>' +
      '<option value="source"' + (dm.pol === 'source' ? ' selected' : '') + '>Заменить словом из первого словаря</option>' +
      '<option value="both"' + (dm.pol === 'both' ? ' selected' : '') + '>Не объединять — перенести всё</option></select></label>' +
      (dm.pol === 'target' ? '<p class="muted small" style="margin-top:-4px">К оставленному слову добавятся недостающие примеры и файлы, а из прогресса сохранится лучший.</p>' : '') +
      '<div id="mg-prev">' + prev + '</div>' +
      '<div class="actions"><button type="button" class="btn" data-act="dm-back">Назад</button><button type="button" class="btn primary" data-act="mg-go">Слить</button></div>';
  }
  function doMerge() {
    if (!dm || dm.src === dm.dst) return;
    const from = dictName(dm.src), to = dictName(dm.dst);
    const pv = runMerge(dm.src, dm.dst, dm.pol, true);
    if (!window.confirm('Слить «' + from + '» в «' + to + '»? Перенесётся слов: ' + pv.moved + (pv.merged + pv.replaced ? ', повторов объединится: ' + (pv.merged + pv.replaced) : '') + '. Словарь «' + from + '» будет удалён.')) return;
    const r = runMerge(dm.src, dm.dst, dm.pol, false);
    core.tomb('dicts', dm.src);
    if (PR().cur === dm.src || PR().cur === 'all') setCur(dm.dst);
    core.commit();
    dm.v = 'list'; dm.src = ''; dm.dst = '';
    renderDm();
    toast('Готово. Перенесено: ' + r.moved + (r.merged + r.replaced ? ', повторов объединено: ' + (r.merged + r.replaced) : ''));
  }
  /* ---------- готовые словари (папка shared на GitHub) ---------- */
  function openShared() {
    dm.v = 'shared';
    renderDm();
    if (dm.sh && dm.sh.state === 'ok') return;
    dm.sh = { state: 'loading', items: [] };
    const my = dm.sh;
    const getText = (url) => fetch(url, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then((b) => csv.decode(b));
    fetch('shared/index.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((j) => Promise.all((j.dicts || []).filter((d) => d && d.id && d.file && d.name).map((d) =>
        getText('shared/' + encodeURIComponent(d.file)).then((t) => ({ id: String(d.id), name: String(d.name), desc: String(d.desc || ''), rows: csv.parse(t).rows })).catch(() => null))))
      .then((items) => { my.items = items.filter(Boolean); my.state = 'ok'; })
      .catch(() => { my.state = 'err'; })
      .then(() => { if (dm && dm.v === 'shared') renderDm(); });
  }
  function sharedHTML() {
    const sh = dm.sh || { state: 'loading', items: [] };
    let h = '<h2>Готовые словари</h2><p class="muted small" style="margin-top:0">Словари, которые выложены для всех. Нажмите «Добавить», и слова скопируются в ваши словари. Прогресс у вас будет свой.</p>';
    if (sh.state === 'loading') h += '<div class="note info">Загружаю список…</div>';
    else if (sh.state === 'err') h += '<div class="note err">Не удалось загрузить список. Проверьте интернет и попробуйте ещё раз.</div>';
    else if (!sh.items.length) h += '<div class="note info">Пока нет готовых словарей.</div>';
    else {
      h += '<div class="dlist">' + sh.items.map((s) => {
        const mine = liveDicts().find((d) => d.src === s.id);
        let miss = 0;
        if (mine) { const have = new Set(wordsOfDict(mine.id).map((w) => normEn(w.en))); miss = s.rows.filter((r) => !have.has(normEn(r.en))).length; }
        return '<div class="di"><div class="di-main"><div class="di-name">' + esc(s.name) + (mine ? '<span class="badge review">добавлен</span>' : '') + '</div>' +
          '<div class="muted small">' + wordsWord(s.rows.length) + (s.desc ? ' · ' + esc(s.desc) : '') + '</div>' +
          (mine && miss ? '<div class="muted small">В готовом появилось новых слов: ' + miss + '</div>' : '') + '</div>' +
          '<div class="di-btns">' + (!mine ? '<button type="button" class="btn primary" data-act="sh-add" data-id="' + esc(s.id) + '">Добавить</button>'
            : miss ? '<button type="button" class="btn primary" data-act="sh-add" data-id="' + esc(s.id) + '">Добавить новые слова</button>' : '') + '</div></div>';
      }).join('') + '</div>';
    }
    return h + '<div class="actions"><button type="button" class="btn" data-act="dm-back">Назад</button></div>';
  }
  function addShared(id) {
    const s = dm && dm.sh && dm.sh.items.find((x) => x.id === id);
    if (!s) return;
    const now = Date.now();
    let d = liveDicts().find((x) => x.src === id);
    const isNew = !d;
    if (!d) {
      let name = s.name.slice(0, 40);
      if (dictNameError(name)) name = (name.slice(0, 31) + ' (готовый)').slice(0, 40);
      let n = 2;
      while (dictNameError(name)) name = (s.name.slice(0, 33) + ' (' + n++ + ')').slice(0, 40);
      d = core.upsert('dicts', { id: core.uid(), name, c: now, src: id });
    }
    const have = new Set(wordsOfDict(d.id).map((w) => normEn(w.en)));
    let added = 0;
    s.rows.forEach((r, i) => {
      const k = normEn(r.en);
      if (have.has(k)) return;
      have.add(k);
      core.S.words.push({ id: core.uid(), en: r.en, ru: r.ru, tr: r.tr, ex: r.ex, fl: [], dict: d.id, c: now + i / 1000, u: now });
      added++;
    });
    if (isNew) setCur(d.id);
    core.commit();
    renderDm();
    toast((isNew ? 'Словарь «' + d.name + '» добавлен и выбран. ' : '') + 'Слов добавлено: ' + added);
  }
  function checkHTML() {
    const rs = core.dictResolver();
    const g = new Map();
    for (const w of liveWords()) { const k = normEn(w.en); if (!g.has(k)) g.set(k, []); g.get(k).push(w); }
    const groups = Array.from(g.values()).filter((a) => a.length > 1).sort((a, b) => a[0].en.localeCompare(b[0].en));
    const inOne = groups.filter((a) => new Set(a.map(rs)).size < a.length).length;
    let h = '<h2>Проверка повторов</h2>';
    if (!groups.length) h += '<div class="note info">Повторов нет: каждое английское слово встречается только один раз.</div>';
    else {
      h += '<div class="note info">Слов, которые встречаются больше одного раза: <b>' + groups.length + '</b>' + (inOne ? ', из них внутри одного словаря: ' + inOne : '') + '. Слово в разных словарях — это нормально; объединить словари можно кнопкой «Слить словари…».</div>' +
        '<div class="dlist">' + groups.slice(0, 40).map((a) => '<div class="dg"><b>' + esc(a[0].en) + '</b>' + a.map((w) => '<div class="small"><span class="muted">' + esc(dictName(rs(w))) + ':</span> ' + esc(w.ru) + '</div>').join('') + '</div>').join('') +
        (groups.length > 40 ? '<div class="muted small">…и ещё ' + (groups.length - 40) + '</div>' : '') + '</div>';
    }
    return h + '<div class="actions"><button type="button" class="btn" data-act="dm-back">Назад</button>' + (liveDicts().length > 1 ? '<button type="button" class="btn primary" data-act="dm-merge">Слить словари…</button>' : '') + '</div>';
  }

  /* ---------- события ---------- */
  const actions = {
    tab: (el) => show(el.dataset.tab),
    chip: () => { if (!M.signedIn) show('settings'); else D.syncNow({ interactive: true }); },
    dicts: () => openDicts(),
    'dm-back': () => { dm.v = 'list'; renderDm(); },
    'dm-pick': (el) => { setCur(el.dataset.id); core.commit(); closeModal(); view.dataset.tab = ''; render(); },
    'dm-ren': (el) => { dm.edit = el.dataset.id; renderDm(); const i = $('#dm-ren'); if (i) { i.focus(); i.select(); } },
    'dm-ren-cancel': () => { dm.edit = ''; renderDm(); },
    'dm-del': (el) => deleteDict(el.dataset.id),
    'dm-reset': (el) => resetDict(el.dataset.id),
    'dm-merge': () => { dm.v = 'merge'; renderDm(); },
    'dm-mergefrom': (el) => { dm.v = 'merge'; dm.src = el.dataset.id; dm.dst = ''; renderDm(); },
    'dm-shared': () => openShared(),
    'sh-add': (el) => addShared(el.dataset.id),
    'dm-check': () => { dm.v = 'check'; renderDm(); },
    'mg-go': () => doMerge(),
    add: () => openWordForm(),
    edit: (el) => openWordForm(el.dataset.id),
    speak: (el) => speakText(el.dataset.text),
    more: () => { wordsUI.limit += 80; renderWordList(); },
    'modal-close': () => closeModal(),
    'more-new': () => openMoreNew(),
    'mn-set': (el) => { const e = $('#mn-n'); if (e) e.value = el.dataset.n; },
    'viewer-close': () => closeViewer(),
    'viewer-bg': (el, e) => { if (e.target === el) closeViewer(); },
    'modal-bg': (el, e) => { if (e.target === el) closeModal(); },
    'speak-field': () => speakText($('#f-en').value),
    'ex-add': () => { syncExFromDom(); form.ex.push({ en: '', ru: '' }); $('#exRows').innerHTML = exHTML(); const r = document.querySelectorAll('#exRows .ex-en'); r[r.length - 1].focus(); },
    'ex-del': (el) => { syncExFromDom(); form.ex.splice(+el.dataset.i, 1); if (!form.ex.length) form.ex.push({ en: '', ru: '' }); $('#exRows').innerHTML = exHTML(); },
    'ex-speak': (el) => { syncExFromDom(); speakText((form.ex[+el.dataset.i] || {}).en); },
    'att-pick': () => { const i = $('#f-files'); i && i.click(); },
    'att-del': (el) => { form.keep = form.keep.filter((x) => x !== el.dataset.id); $('#attList').innerHTML = attHTML(); },
    'pend-del': (el) => { form.pending.splice(+el.dataset.i, 1); $('#attList').innerHTML = attHTML(); },
    'save-more': () => saveWord(true),
    'del-word': () => deleteWord(),
    'open-file': (el) => openFile(el.dataset.id),
    'cache-file': (el) => cacheFile(el.dataset.id),
    import: () => openImport(),
    'imp-pick': () => $('#imp-file').click(),
    'imp-parse': () => parseImport($('#imp-text').value),
    'imp-do': () => doImport(),
    tpl: () => download('eng-word-template.csv', csv.TEMPLATE),
    export: () => {
      const sc = curId();
      const ws = scopeWords().sort((a, b) => (a.c || 0) - (b.c || 0));
      if (!ws.length) { toast('Нет слов для экспорта'); return; }
      const nm = liveDicts().length > 1 ? '-' + scopeLabel(sc).replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') : '';
      download('eng-word' + nm + '-' + dateStr() + '.csv', csv.stringify(ws));
    },
    'study-start': (el) => startStudy(el && el.dataset.mode),
    'study-close': () => closeStudy(),
    reveal: () => reveal(),
    grade: (el) => grade(el.dataset.know === '1'),
    undo: () => undo(),
    signin: () => D.signIn().then(() => { if (tab === 'settings') renderSettings(); toast('Вы вошли в Google'); }).catch((e) => toast(e.message || 'Не удалось войти')),
    sync: () => D.syncNow({ interactive: true }).then((ok) => { if (ok) toast('Синхронизировано'); }),
    signout: () => { if (window.confirm('Выйти из Google? Слова останутся на этом устройстве.')) { D.signOut(); renderSettings(); } },
    install: () => { if (installEvt) { installEvt.prompt(); installEvt = null; } },
    'clear-files': async () => { if (window.confirm('Удалить скачанные файлы с этого устройства? Они останутся на Google Drive.')) { await core.blobClear().catch(() => {}); refreshData(); toast('Файлы очищены'); } },
    wipe: () => wipeLocal(),
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const fn = actions[el.dataset.act];
    if (fn) fn(el, e);
  });
  document.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('[data-act="signin"]')) D.preload(); });
  document.addEventListener('submit', (e) => {
    const id = e.target.id;
    if (id === 'wf') { e.preventDefault(); saveWord(false); }
    else if (id === 'dmf') { e.preventDefault(); createDict($('#dm-new').value); }
    else if (id === 'mnf') { e.preventDefault(); startMoreNew(); }
    else if (id === 'dm-renf') { e.preventDefault(); renameDict(e.target.dataset.id, $('#dm-ren').value); }
  });
  document.addEventListener('input', (e) => {
    const id = e.target.id;
    if (id === 'w-q') { wordsUI.q = e.target.value; wordsUI.limit = 80; renderWordList(); }
    else if (id === 'f-en') checkDup();
    else if (id === 's-rate') { $('#rate-v').textContent = (+e.target.value).toFixed(2).replace('.', ','); }
  });
  document.addEventListener('change', (e) => {
    const t = e.target, id = t.id;
    if (id === 'w-f') { wordsUI.filter = t.value; wordsUI.limit = 80; renderWordList(); }
    else if (id === 'd-sel') { setCur(t.value); core.commit(); wordsUI.limit = 80; view.dataset.tab = ''; render(); }
    else if (id === 'f-dict') { form.dict = t.value; checkDup(); }
    else if (id === 'imp-dict') { $('#imp-newwrap').hidden = t.value !== '__new'; if (t.value === '__new') $('#imp-newname').focus(); previewImport(); }
    else if (id === 'mg-src') { dm.src = t.value; renderDm(); }
    else if (id === 'mg-dst') { dm.dst = t.value; renderDm(); }
    else if (id === 'mg-pol') { dm.pol = t.value; renderDm(); }
    else if (id === 's-new') { const n = Math.max(0, Math.min(500, parseInt(t.value, 10) || 0)); t.value = n; core.setSettings({ newPerDay: n }); core.commit(); }
    else if (id === 's-max') { const n = Math.max(2, Math.min(3650, parseInt(t.value, 10) || srs.DEFAULT_MAX_DAYS)); t.value = n; core.setSettings({ maxDays: n }); core.commit(); }
    else if (id === 's-df' || id === 's-db') {
      const f = $('#s-df').checked, b = $('#s-db').checked;
      if (!f && !b) { t.checked = true; toast('Нужно оставить хотя бы одно направление'); return; }
      core.setSettings({ dirs: { f, b } }); core.commit();
    }
    else if (id === 's-rate') { core.setSettings({ rate: +t.value }); core.commit(); }
    else if (id === 's-accent') { core.setSettings({ accent: t.value, voice: '' }); core.commit(); fillVoices(); }
    else if (id === 's-voice') { core.setSettings({ voice: t.value }); core.commit(); }
    else if (id === 's-auto') { core.setSettings({ autoSpeak: t.checked }); core.commit(); }
    else if (id === 'f-files') {
      for (const f of Array.from(t.files)) {
        if (f.size > D.MAX_FILE) { showFormErr('Файл «' + f.name + '» больше ' + Math.round(D.MAX_FILE / 1048576) + ' МБ'); continue; }
        form.pending.push(f);
      }
      t.value = '';
      $('#attList').innerHTML = attHTML();
    }
    else if (id === 'imp-file') {
      const f = t.files[0];
      if (!f) return;
      f.arrayBuffer().then((buf) => { const text = csv.decode(buf); $('#imp-text').value = text.length > 200000 ? '' : text; parseImport(text); });
      t.value = '';
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if ($('#viewer-root').innerHTML) closeViewer(); else if ($('#modal-root').innerHTML) closeModal(); else if (study) closeStudy(); return; }
    if (!study || $('#modal-root').innerHTML || $('#viewer-root').innerHTML) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.key === ' ' || e.key === 'Enter') {
      // кнопка внутри экрана занятия нажмётся сама; фокус, оставшийся на кнопках под экраном, не должен перехватывать пробел
      if (tag === 'button' && e.target.closest('#study-root')) return;
      e.preventDefault();
      if (!study.revealed) reveal(); else grade(true);
    } else if (e.key === '1') { grade(false); }
    else if (e.key === '2') { grade(true); }
    else if (e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы') { const w = study.cur && getWord(study.cur.id); if (w) speakText(w.en); }
    else if (e.key === 'z' || e.key === 'я' || e.key === 'Backspace') { undo(); }
  });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (tab === 'settings' && !study) renderSettings(); });

  /* ---------- запуск ---------- */
  async function boot() {
    await core.init();
    // настройки, которые раньше хранились только на устройстве, переносим в синхронизируемые
    let moved = false;
    for (const k of ['accent', 'voice', 'rate', 'autoSpeak', 'cur']) {
      if (M[k] !== undefined) {
        if (!PR().ts[k] && M[k] !== core.defaults().settings[k]) { PR()[k] = M[k]; PR().ts[k] = 1; }
        delete M[k]; moved = true;
      }
    }
    if (moved) { core.saveMeta(); core.persist(); }
    core.hooks.changed = onChanged;
    core.hooks.error = toast;
    D.onstatus = () => { updateChip(); };
    tts.onchange = fillVoices;
    render();
    D.start();
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
    EW.ui = { show, render, openWordForm, startStudy, grade, reveal, toast };
    EW.ready = true;
    document.documentElement.dataset.ready = '1';
  }
  boot();
})();

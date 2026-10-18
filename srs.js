/* English Words — уровни изучения и интервалы повторения. Чистые функции, без доступа к DOM.
 *
 * У каждого СЛОВА один уровень изучения lv (хранится в w.f; старое поле w.b больше не используется).
 * В занятии слово показывается во всех включённых направлениях (en→ru и ru→en). Слово засчитано, только когда верно
 * отвечено в каждом направлении; направление, в котором ошиблись, повторяется в этом же занятии до «знаю».
 * Если была хоть одна ошибка — уровень не растёт.
 *
 * Уровни:
 *   0 — слово ещё не выучено (не показывалось или проходит первое обучение);
 *   1, 2, 3 — следующее повторение через 10 минут, 1 час, 6 часов;
 *   4 — через сутки, 5 — через двое суток, 6 — через трое… (каждый уровень +1 сутки),
 *   но не больше, чем «Максимальный интервал» из настроек (maxDays).
 * Уровень хранится в данных, а время следующего повторения считается из него: at (время последнего ответа) + интервал уровня.
 * Поэтому, если интервалы поменять, все слова пересчитаются сами.
 *
 * Поля карточки: lv, at (мс), intro (номер дня, когда слово показали впервые), ks (знал слово с первого взгляда),
 * miss (сколько раз подряд ответили «не знаю» в текущем круге), pend (слово нужно показать ещё раз в этом занятии).
 */
(function () {
  'use strict';
  const EW = (window.EW = window.EW || {});

  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const FIXED = [10 * MIN, HOUR, 6 * HOUR]; // уровни 1–3
  const KNOWN_LEVEL = 4; // «знаю» на новом слове: считаем, что три повторения (10 мин, 1 ч, 6 ч) уже пройдены
  const DEFAULT_MAX_DAYS = 60;
  const GAP = 4; // через сколько других карточек вернуть слово, на которое ответили «не знаю»
  const MASTERED_DAYS = 21;

  // Номер «учебного дня». День меняется в 4 утра.
  function dayNum(ms) {
    const d = new Date((ms == null ? Date.now() : ms) - 4 * HOUR);
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
  }

  const maxDaysOf = (o) => Math.max(1, Math.min(3650, Math.round((o && o.maxDays) || DEFAULT_MAX_DAYS)));
  const maxLevel = (maxDays) => 3 + Math.max(1, maxDays || DEFAULT_MAX_DAYS);
  function intervalMs(lv, maxDays) {
    if (lv <= 0) return 0;
    if (lv <= 3) return FIXED[lv - 1];
    return Math.min(maxDays || DEFAULT_MAX_DAYS, lv - 3) * DAY;
  }

  function blank() { return { lv: 0, at: 0, intro: 0, ks: false, miss: 0, pend: false }; }

  // Приводит карточку к текущему виду. Карточки старой версии (st/iv/ease…) переводятся в уровни.
  function norm(card) {
    if (!card) return blank();
    if (card.lv !== undefined) return Object.assign(blank(), card);
    const c = blank();
    c.intro = card.intro || 0;
    if (card.st === 2) {
      c.lv = 3 + Math.max(1, Math.min(3650, Math.round(card.iv || 1)));
      c.at = card.last || Date.now();
    } else if (card.st === 1 || card.st === 3) {
      c.lv = 1;
      c.at = card.last || Date.now();
    }
    return c;
  }
  const level = (card) => norm(card).lv;

  const isNew = (c) => c.lv === 0 && !c.pend;
  function dueAt(card, maxDays) {
    const c = norm(card);
    if (c.pend) return 0;
    if (c.lv > 0) return c.at + intervalMs(c.lv, maxDays);
    return Infinity;
  }
  const isMastered = (card) => norm(card).lv >= 3 + MASTERED_DAYS;

  // Карточка слова (уровень хранится в w.f; у старых данных может быть только w.b)
  const cardOf = (w) => norm(w && w.f != null ? w.f : w && w.b);
  // Включённые направления в порядке показа: сначала en→ru, потом ru→en
  function dirsOf(dirs) {
    const a = [];
    if (!dirs || dirs.f) a.push('f');
    if (!dirs || dirs.b) a.push('b');
    return a.length ? a : ['f'];
  }

  /*
   * Итог занятия по слову, когда оно верно отвечено во всех направлениях. miss — сколько раз за занятие ответили «не знаю».
   * Новое слово: без ошибок → уровень 4 (считаем, что три повторения уже пройдены); с ошибками → уровень 1.
   * Повторение: без ошибок → уровень +1; одна ошибка → уровень не меняется; две и больше → на 1 ниже.
   */
  function finish(card, miss, now, o) {
    now = now == null ? Date.now() : now;
    const top = maxLevel(maxDaysOf(o));
    const c = norm(card);
    const today = dayNum(now);
    if (c.lv === 0) {
      if (!miss) return Object.assign(c, { lv: Math.min(KNOWN_LEVEL, top), at: now, intro: today, ks: true, miss: 0, pend: false });
      return Object.assign(c, { lv: 1, at: now, intro: c.intro || today, ks: false, miss: 0, pend: false });
    }
    const lv = !miss ? Math.min(c.lv + 1, top) : miss === 1 ? Math.min(c.lv, top) : Math.max(1, c.lv - 1);
    return Object.assign(c, { lv, at: now, miss: 0, pend: false });
  }
  // «Не знаю» в занятии: слово не добито. Уровень не меняется, запоминаем число ошибок.
  function failed(card, miss, now) {
    now = now == null ? Date.now() : now;
    const c = norm(card);
    if (c.lv === 0) return Object.assign(c, { intro: c.intro || dayNum(now), ks: false, miss, pend: true });
    return Object.assign(c, { miss, pend: true });
  }

  // Ручная смена уровня. 0 — слово снова становится новым.
  function setLevel(card, lv, now, o) {
    now = now == null ? Date.now() : now;
    lv = Math.max(0, Math.min(maxLevel(maxDaysOf(o)), Math.round(+lv || 0)));
    if (lv === 0) return blank();
    const c = norm(card);
    return Object.assign(c, { lv, at: now, pend: false, miss: 0, intro: c.intro || dayNum(now), ks: c.intro ? c.ks : true });
  }

  function fmtInterval(ms) {
    const m = Math.max(1, Math.round(ms / MIN));
    if (m < 60) return m + ' мин';
    const h = Math.round(m / 60);
    if (h < 24) return h + ' ч';
    const d = Math.round(ms / DAY);
    if (d < 60) return d + ' д';
    if (d < 365) return Math.round(d / 30) + ' мес';
    return (Math.round((d / 365) * 10) / 10).toString().replace('.', ',') + ' г';
  }
  // Когда карточка «созреет»: «сейчас» или «через …»
  function fmtDue(card, now, o) {
    now = now == null ? Date.now() : now;
    const d = dueAt(card, maxDaysOf(o));
    if (d === Infinity) return '';
    if (d <= now) return 'сейчас';
    return 'через ' + fmtInterval(d - now);
  }
  // Подписи под кнопками. miss — ошибок по слову в этом занятии; more — осталось ли ещё направление
  function preview(card, miss, more, now, o) {
    if (more) return { yes: 'ещё в другую сторону', no: 'ещё раз сегодня' };
    const yes = finish(card, miss, now, o);
    return { yes: 'ур. ' + yes.lv + ' · через ' + fmtInterval(intervalMs(yes.lv, maxDaysOf(o))), no: 'ещё раз сегодня' };
  }

  /* Сколько новых слов уже «потрачено» сегодня: показанные впервые сегодня, кроме тех, что сразу ответили «знаю». */
  function introducedToday(words, today) {
    let n = 0;
    for (const w of words) {
      if (w.d) continue;
      const c = cardOf(w);
      if ((c.lv > 0 || c.pend) && c.intro === today && !c.ks) n++;
    }
    return n;
  }

  // Новые слова выбираются случайно (o.rnd — подмена генератора для тестов)
  function shuffle(arr, rnd) {
    rnd = rnd || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /*
   * Очередь занятия: слова, которые не дали выучить в прошлый раз, затем подошедшие повторения (самые запоздавшие первыми),
   * затем случайные новые слова в пределах дневного лимита. Каждое слово даёт по карточке на каждое включённое направление;
   * вторая карточка слова стоит через несколько других.
   * o.mode: 'new' — только новые, 'review' — только повторение, иначе всё вместе.
   */
  function buildQueue(words, o) {
    const now = o.now == null ? Date.now() : o.now;
    const today = dayNum(now);
    const D = dirsOf(o.dirs);
    const md = maxDaysOf(o);
    const mode = o.mode;
    const pendN = [], pendR = [], rev = [], fresh = [];
    for (const w of words) {
      if (w.d) continue;
      const c = cardOf(w);
      if (c.pend) (c.lv === 0 ? pendN : pendR).push({ w });
      else if (c.lv > 0) { const d = c.at + intervalMs(c.lv, md); if (d <= now) rev.push({ w, due: d }); }
      else fresh.push({ w });
    }
    const byC = (a, b) => (a.w.c || 0) - (b.w.c || 0);
    pendN.sort(byC); pendR.sort(byC);
    rev.sort((a, b) => a.due - b.due);
    shuffle(fresh, o.rnd);
    // o.extraNew — «изучить ещё сегодня»: берём столько новых слов, сколько попросили, дневной лимит не учитывается
    const limit = o.extraNew != null ? Math.max(0, Math.floor(o.extraNew)) : Math.max(0, (o.newPerDay == null ? 10 : o.newPerDay) - introducedToday(words, today));
    const news = fresh.slice(0, limit);
    const units = [];
    const U = (arr, kind) => arr.forEach((x) => units.push({ id: x.w.id, kind }));
    if (mode !== 'new') U(pendR, 'learn');
    if (mode !== 'review') U(pendN, 'learn');
    if (mode !== 'new') U(rev, 'review');
    if (mode !== 'review') U(news, 'new');
    // Порядок полностью случайный: слова вперемешку, направление каждой карточки и очерёдность направлений тоже случайные,
    // две карточки одного слова не стоят рядом
    shuffle(units, o.rnd);
    const items = [];
    for (const u of units) for (const k of D) items.push({ id: u.id, k, kind: u.kind });
    spread(shuffle(items, o.rnd), o.rnd);
    return { items, stats: { learn: pendN.length + pendR.length, review: rev.length, newLeft: news.length, newEligible: fresh.length, reviewTotal: pendR.length + rev.length, newTotal: pendN.length + news.length } };
  }

  // Расталкивает карточки одного слова: между ними должно быть хотя бы несколько других (если очередь достаточно длинная)
  function spread(items, rnd) {
    rnd = rnd || Math.random;
    const n = items.length;
    const gap = Math.min(3, Math.floor(n / 4));
    if (gap < 1) return items;
    const bad = (i) => { for (let d = 1; d <= gap; d++) { if (i - d >= 0 && items[i - d].id === items[i].id) return true; if (i + d < n && items[i + d].id === items[i].id) return true; } return false; };
    for (let pass = 0; pass < 50; pass++) {
      let fixed = true;
      for (let i = 0; i < n; i++) {
        if (!bad(i)) continue;
        fixed = false;
        for (let t = 0; t < 30; t++) {
          const j = Math.floor(rnd() * n);
          if (j === i) continue;
          const a = items[i]; items[i] = items[j]; items[j] = a;
          if (!bad(i) && !bad(j)) break;
          const b = items[i]; items[i] = items[j]; items[j] = b;
        }
      }
      if (fixed) break;
    }
    return items;
  }

  /*
   * Вставляет карточки слова в очередь в случайные места так, чтобы между двумя карточками одного слова стояли другие.
   * maxAhead — если задано, место ищется не дальше этого числа карточек от начала (для возврата после «не знаю»).
   */
  function insertCards(queue, cards, rnd, maxAhead) {
    rnd = rnd || Math.random;
    for (const c of shuffle(cards.slice(), rnd)) {
      const twins = [];
      queue.forEach((x, i) => { if (x.id === c.id) twins.push(i); });
      const gap = Math.min(3, Math.max(1, Math.floor(queue.length / 3)));
      const okAt = (k) => twins.every((p) => k <= p - gap || k > p + gap);
      let cand = [];
      const hi = maxAhead == null ? queue.length : Math.min(queue.length, maxAhead);
      const lo = maxAhead == null ? 0 : Math.min(2, hi);
      for (let k = lo; k <= hi; k++) if (okAt(k)) cand.push(k);
      if (!cand.length && maxAhead != null) for (let k = 0; k <= queue.length; k++) if (okAt(k)) cand.push(k);
      if (!cand.length) { // места нет (очередь совсем короткая) — берём самое дальнее от второй карточки слова
        let best = -1, bd = -1;
        for (let k = 0; k <= queue.length; k++) { const d = Math.min.apply(null, twins.map((p) => Math.abs(k - p - 0.5))); if (d > bd) { bd = d; best = k; } }
        cand = [best];
      }
      queue.splice(cand[Math.floor(rnd() * cand.length)], 0, c);
    }
    return queue;
  }

  // Ещё одно новое слово для занятия (когда прежнее оказалось знакомым). exclude — множество id слов, которые уже в очереди.
  function nextNew(words, o, exclude) {
    const pool = [];
    for (const w of words) {
      if (w.d) continue;
      if (exclude && exclude.has(w.id)) continue;
      const c = cardOf(w);
      if (c.lv === 0 && !c.pend) pool.push(w);
    }
    if (!pool.length) return null;
    const w = pool[Math.floor((o.rnd || Math.random)() * pool.length)];
    return dirsOf(o.dirs).map((k) => ({ id: w.id, k, kind: 'new' }));
  }

  function stats(words, o) {
    const q = buildQueue(words, o);
    let total = 0, mastered = 0;
    for (const w of words) {
      if (w.d) continue;
      total++;
      if (isMastered(cardOf(w))) mastered++;
    }
    return Object.assign({ total, mastered }, q.stats);
  }

  // Прогресс по набору слов: начато — слово уже показывали; изучено — повторение раз в 3 недели и реже
  function progress(words) {
    let total = 0, started = 0, learned = 0;
    for (const w of words) {
      if (w.d) continue;
      total++;
      const c = cardOf(w);
      if (c.lv > 0 || c.pend) started++;
      if (isMastered(c)) learned++;
    }
    return { total, started, learned };
  }

  // Состояние слова для списка: new — не показывалось; due — пора повторить; learning — уровни до суток; review — выучивается
  function wordState(w, now, o) {
    now = now == null ? Date.now() : now;
    const c = cardOf(w);
    if (!(c.lv > 0 || c.pend)) return 'new';
    if (c.pend || c.at + intervalMs(c.lv, maxDaysOf(o)) <= now) return 'due';
    if (c.lv < 4) return 'learning';
    return 'review';
  }
  const wordLevel = (w) => cardOf(w).lv;

  EW.srs = {
    dayNum, blank, norm, level, cardOf, dirsOf, finish, failed, setLevel, isNew, dueAt, isMastered, intervalMs, maxLevel, maxDaysOf,
    fmtInterval, fmtDue, preview, introducedToday, buildQueue, insertCards, nextNew, stats, progress, wordState, wordLevel,
    GAP, KNOWN_LEVEL, DEFAULT_MAX_DAYS,
  };
})();

/* English Words — уровни изучения и интервалы повторения. Чистые функции, без доступа к DOM.
 *
 * У каждой карточки (направление слова) есть УРОВЕНЬ изучения lv:
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

  /*
   * Ответ на карточку. know = true («знаю») или false («не знаю»). Возвращает новую карточку.
   * Новое слово: «знаю» сразу → уровень 4; «не знаю» → слово вернётся в этом же занятии, пока не ответят «знаю», затем уровень 1.
   * Повторение: «знаю» с первого раза → уровень +1; один «не знаю» перед «знаю» → уровень не меняется;
   * два и больше «не знаю» → уровень на 1 ниже.
   */
  function answer(card, know, now, o) {
    now = now == null ? Date.now() : now;
    const top = maxLevel(maxDaysOf(o));
    const c = norm(card);
    const today = dayNum(now);
    if (c.lv === 0) {
      if (!c.pend) {
        if (know) return Object.assign(c, { lv: Math.min(KNOWN_LEVEL, top), at: now, intro: today, ks: true, miss: 0, pend: false });
        return Object.assign(c, { intro: today, ks: false, pend: true, miss: 1 });
      }
      if (know) return Object.assign(c, { lv: 1, at: now, miss: 0, pend: false });
      return Object.assign(c, { miss: c.miss + 1 });
    }
    if (know) {
      const lv = c.miss === 0 ? Math.min(c.lv + 1, top) : c.miss === 1 ? Math.min(c.lv, top) : Math.max(1, c.lv - 1);
      return Object.assign(c, { lv, at: now, miss: 0, pend: false });
    }
    return Object.assign(c, { miss: c.miss + 1, pend: true });
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
  // Подписи под кнопками: что будет после «знаю» / «не знаю»
  function preview(card, now, o) {
    const yes = answer(card, true, now, o);
    return { yes: 'ур. ' + yes.lv + ' · через ' + fmtInterval(intervalMs(yes.lv, maxDaysOf(o))), no: 'ещё раз сегодня' };
  }

  // Какие карточки есть у слова при текущих настройках
  function cardsOf(w, dirs, today) {
    const out = [];
    if (dirs.f) out.push('f');
    if (dirs.b) {
      // обратное направление открываем не раньше следующего дня после прямого
      const f = norm(w.f);
      if (!dirs.f || (f.lv > 0 && !f.pend && f.intro < today)) out.push('b');
    }
    return out;
  }

  /*
   * Сколько новых карточек уже «потрачено» сегодня: считаются те, что показали впервые сегодня,
   * кроме слов, о которых сразу ответили «знаю» (они в дневной лимит не входят).
   */
  function introducedToday(words, today) {
    let n = 0;
    for (const w of words) {
      if (w.d) continue;
      for (const k of ['f', 'b']) {
        if (!w[k]) continue;
        const c = norm(w[k]);
        if ((c.lv > 0 || c.pend) && c.intro === today && !c.ks) n++;
      }
    }
    return n;
  }

  const byNew = (a, b) => (a.w.c || 0) - (b.w.c || 0) || (a.k === 'f' ? -1 : 1) - (b.k === 'f' ? -1 : 1);

  /*
   * Очередь занятия: сначала слова, которые не дали выучить в прошлый раз, затем подошедшие повторения
   * (самые запоздавшие первыми), затем новые слова в пределах дневного лимита.
   */
  function buildQueue(words, o) {
    const now = o.now == null ? Date.now() : o.now;
    const today = dayNum(now);
    const dirs = o.dirs || { f: true, b: true };
    const md = maxDaysOf(o);
    const pend = [], rev = [], fresh = [];
    for (const w of words) {
      if (w.d) continue;
      for (const k of cardsOf(w, dirs, today)) {
        const c = norm(w[k]);
        if (c.pend) pend.push({ w, k });
        else if (c.lv > 0) { const d = c.at + intervalMs(c.lv, md); if (d <= now) rev.push({ w, k, due: d }); }
        else fresh.push({ w, k });
      }
    }
    pend.sort((a, b) => (a.w.c || 0) - (b.w.c || 0));
    rev.sort((a, b) => a.due - b.due);
    fresh.sort(byNew);
    const limit = Math.max(0, (o.newPerDay == null ? 10 : o.newPerDay) - introducedToday(words, today));
    const news = fresh.slice(0, limit);
    const items = []
      .concat(pend.map((x) => ({ id: x.w.id, k: x.k, kind: 'learn' })))
      .concat(rev.map((x) => ({ id: x.w.id, k: x.k, kind: 'review' })))
      .concat(news.map((x) => ({ id: x.w.id, k: x.k, kind: 'new' })));
    return { items, stats: { learn: pend.length, review: rev.length, newLeft: news.length, newEligible: fresh.length } };
  }

  // Ещё одно новое слово для занятия (когда прежнее оказалось уже знакомым). exclude — множество «id:k», которые уже в очереди.
  function nextNew(words, o, exclude) {
    const now = o.now == null ? Date.now() : o.now;
    const today = dayNum(now);
    const dirs = o.dirs || { f: true, b: true };
    let best = null;
    for (const w of words) {
      if (w.d) continue;
      for (const k of cardsOf(w, dirs, today)) {
        if (exclude && exclude.has(w.id + ':' + k)) continue;
        if (!isNew(norm(w[k]))) continue;
        const x = { w, k };
        if (!best || byNew(x, best) < 0) best = x;
      }
    }
    return best ? { id: best.w.id, k: best.k, kind: 'new' } : null;
  }

  function stats(words, o) {
    const q = buildQueue(words, o);
    const dirs = o.dirs || { f: true, b: true };
    let total = 0, mastered = 0;
    for (const w of words) {
      if (w.d) continue;
      total++;
      const ks = ['f', 'b'].filter((k) => dirs[k]);
      if (ks.length && ks.every((k) => w[k] && isMastered(w[k]))) mastered++;
    }
    return Object.assign({ total, mastered }, q.stats);
  }

  // Состояние слова для списка: new — не показывалось; due — пора повторить; learning — уровни до суток; review — выучивается
  function wordState(w, now, o) {
    now = now == null ? Date.now() : now;
    const md = maxDaysOf(o);
    const cs = ['f', 'b'].map((k) => w[k]).filter(Boolean).map(norm).filter((c) => c.lv > 0 || c.pend);
    if (!cs.length) return 'new';
    if (cs.some((c) => c.pend || c.at + intervalMs(c.lv, md) <= now)) return 'due';
    if (cs.some((c) => c.lv < 4)) return 'learning';
    return 'review';
  }
  // Уровень слова для списка: по основному направлению (если оно отключено — по обратному)
  function wordLevel(w, dirs) {
    const k = !dirs || dirs.f || !dirs.b ? 'f' : 'b';
    return level(w[k]);
  }

  EW.srs = {
    dayNum, blank, norm, level, answer, setLevel, isNew, dueAt, isMastered, intervalMs, maxLevel, maxDaysOf,
    fmtInterval, fmtDue, preview, cardsOf, introducedToday, buildQueue, nextNew, stats, wordState, wordLevel,
    GAP, KNOWN_LEVEL, DEFAULT_MAX_DAYS,
  };
})();

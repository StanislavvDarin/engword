/* English Words — интервальное повторение (по схеме SM-2 с шагами обучения). Чистые функции, без доступа к DOM. */
(function () {
  'use strict';
  const EW = (window.EW = window.EW || {});

  const STEPS = [1, 10]; // минуты: шаги обучения нового слова
  const RELEARN = [10]; // минуты: шаг после ошибки
  const GRAD_IV = 1; // дней после успешного обучения
  const EASY_IV = 4; // дней, если «Легко» на этапе обучения
  const START_EASE = 2.5;
  const MAX_IV = 3650;
  const AHEAD_MIN = 20; // если больше нечего показывать, берём карточки, которые «созреют» в ближайшие 20 минут

  // Номер «учебного дня». День меняется в 4 утра, как в Anki.
  function dayNum(ms) {
    const d = new Date((ms == null ? Date.now() : ms) - 4 * 36e5);
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
  }

  const NEW = 0, LEARN = 1, REVIEW = 2, RELEARNING = 3;
  function blank() {
    return { st: NEW, step: 0, ease: START_EASE, iv: 0, due: 0, lapses: 0, reps: 0, intro: 0, last: 0 };
  }
  const isMs = (c) => c.st === LEARN || c.st === RELEARNING;

  // grade: 0 снова, 1 трудно, 2 хорошо, 3 легко
  function review(card, grade, now) {
    now = now == null ? Date.now() : now;
    const today = dayNum(now);
    const c = Object.assign(blank(), card || {});
    const wasNew = c.st === NEW;
    c.reps++;
    c.last = now;
    if (wasNew) c.intro = today;

    const toStep = (steps, i) => {
      c.step = i;
      c.due = now + steps[i] * 60000;
    };
    const graduate = (iv) => {
      c.st = REVIEW;
      c.iv = Math.min(MAX_IV, Math.max(1, iv));
      c.due = today + c.iv;
      c.step = 0;
    };

    if (c.st === NEW || c.st === LEARN) {
      if (c.st === NEW) c.st = LEARN;
      if (grade === 0) toStep(STEPS, 0);
      else if (grade === 1) { c.due = now + Math.round(STEPS[c.step] * 1.5) * 60000; }
      else if (grade === 2) {
        if (c.step + 1 < STEPS.length) toStep(STEPS, c.step + 1);
        else graduate(GRAD_IV);
      } else graduate(EASY_IV);
    } else if (c.st === RELEARNING) {
      if (grade === 0) toStep(RELEARN, 0);
      else if (grade === 1) c.due = now + Math.round(RELEARN[c.step] * 1.5) * 60000;
      else if (grade === 2) graduate(Math.max(1, c.iv));
      else graduate(Math.max(1, c.iv) + 1);
    } else {
      // REVIEW
      if (grade === 0) {
        c.lapses++;
        c.ease = Math.max(1.3, c.ease - 0.2);
        c.iv = Math.max(1, Math.round(c.iv * 0.5));
        c.st = RELEARNING;
        toStep(RELEARN, 0);
      } else if (grade === 1) {
        c.ease = Math.max(1.3, c.ease - 0.15);
        graduate(Math.max(c.iv + 1, Math.round(c.iv * 1.2)));
      } else if (grade === 2) {
        graduate(Math.max(c.iv + 1, Math.round(c.iv * c.ease)));
      } else {
        c.ease = c.ease + 0.15;
        graduate(Math.max(c.iv + 1, Math.round(c.iv * c.ease * 1.3)));
      }
    }
    c.ease = Math.round(c.ease * 100) / 100;
    return c;
  }

  function fmtDue(c, now) {
    now = now == null ? Date.now() : now;
    if (isMs(c)) {
      const m = Math.max(1, Math.round((c.due - now) / 60000));
      if (m < 60) return m + ' мин';
      return Math.round(m / 60) + ' ч';
    }
    const d = c.due - dayNum(now);
    if (d < 30) return d + ' д';
    if (d < 365) return Math.round(d / 30) + ' мес';
    return (Math.round((d / 365) * 10) / 10).toString().replace('.', ',') + ' г';
  }
  function preview(card, now) {
    return [0, 1, 2, 3].map((g) => fmtDue(review(card, g, now), now));
  }

  // Подготовка: какие карточки есть у слова при текущих настройках
  function cardsOf(w, dirs, today) {
    const out = [];
    if (dirs.f) out.push('f');
    if (dirs.b) {
      // обратное направление открываем не раньше следующего дня после прямого
      const f = w.f;
      if (!dirs.f || (f && f.st > NEW && f.intro < today)) out.push('b');
    }
    return out;
  }

  /*
   * Выбор следующей карточки за один проход по словам.
   * Порядок: обучаемые (когда подошло время) → повторения → новые (в пределах дневного лимита) → «заглядывание вперёд».
   */
  function pickNext(words, opts) {
    const now = opts.now == null ? Date.now() : opts.now;
    const today = dayNum(now);
    const dirs = opts.dirs || { f: true, b: true };
    let introduced = 0;
    let bestLearn = null, bestRev = null, bestNew = null, ahead = null;
    let nLearn = 0, nRev = 0, nNewEligible = 0;
    for (const w of words) {
      if (w.d) continue;
      for (const k of ['f', 'b']) {
        const c = w[k];
        if (c && c.st > NEW && c.intro === today) introduced++;
      }
      for (const k of cardsOf(w, dirs, today)) {
        const c = w[k];
        if (!c || c.st === NEW) {
          nNewEligible++;
          if (!bestNew || (w.c || 0) < (bestNew.w.c || 0) || ((w.c || 0) === (bestNew.w.c || 0) && k === 'f' && bestNew.k === 'b')) bestNew = { w, k };
        } else if (isMs(c)) {
          if (c.due <= now) {
            nLearn++;
            if (!bestLearn || c.due < bestLearn.c.due) bestLearn = { w, k, c };
          } else if (c.due <= now + AHEAD_MIN * 60000) {
            if (!ahead || c.due < ahead.c.due) ahead = { w, k, c };
          }
        } else if (c.due <= today) {
          nRev++;
          if (!bestRev || c.due < bestRev.c.due) bestRev = { w, k, c };
        }
      }
    }
    const newLeft = Math.max(0, (opts.newPerDay == null ? 10 : opts.newPerDay) - introduced);
    const newCount = Math.min(newLeft, nNewEligible);
    const stats = { learn: nLearn, review: nRev, newLeft: newCount, introduced };
    let pick = null, kind = '';
    if (bestLearn) { pick = bestLearn; kind = 'learn'; }
    else if (bestRev) { pick = bestRev; kind = 'review'; }
    else if (bestNew && newLeft > 0) { pick = { w: bestNew.w, k: bestNew.k, c: bestNew.w[bestNew.k] || blank() }; kind = 'new'; }
    else if (ahead) { pick = ahead; kind = 'learn'; }
    return { pick, kind, stats };
  }

  function stats(words, opts) {
    const r = pickNext(words, opts);
    let total = 0, mastered = 0, learning = 0;
    for (const w of words) {
      if (w.d) continue;
      total++;
      for (const k of ['f', 'b']) {
        const c = w[k];
        if (c && c.st === REVIEW && c.iv >= 21) mastered++;
        if (c && c.st > NEW && c.st !== REVIEW) learning++;
      }
    }
    return Object.assign({ total, mastered, learning }, r.stats);
  }

  function wordState(w, now) {
    const today = dayNum(now);
    const cs = ['f', 'b'].map((k) => w[k]).filter(Boolean);
    if (!cs.length || cs.every((c) => c.st === NEW)) return 'new';
    const due = cs.some((c) => (isMs(c) ? c.due <= (now == null ? Date.now() : now) : c.st === REVIEW && c.due <= today));
    if (due) return 'due';
    if (cs.some((c) => c.st === LEARN || c.st === RELEARNING)) return 'learning';
    return 'review';
  }

  EW.srs = { dayNum, blank, review, preview, fmtDue, pickNext, stats, wordState, cardsOf, NEW, LEARN, REVIEW, RELEARNING, STEPS };
})();

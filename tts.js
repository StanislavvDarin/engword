/* English Words — синтезатор речи (Web Speech API). Голоса берутся из самого устройства. */
(function () {
  'use strict';
  const EW = (window.EW = window.EW || {});
  const syn = window.speechSynthesis;
  const ok = !!(syn && window.SpeechSynthesisUtterance);
  let voices = [];

  function load() {
    if (!ok) return;
    voices = (syn.getVoices() || []).filter((v) => /^en([-_]|$)/i.test(v.lang));
  }
  if (ok) {
    load();
    if (syn.addEventListener) syn.addEventListener('voiceschanged', () => { load(); EW.tts.onchange && EW.tts.onchange(); });
    else syn.onvoiceschanged = () => { load(); EW.tts.onchange && EW.tts.onchange(); };
  }

  // Чем «естественнее» голос, тем выше оценка
  function score(v, accent) {
    let s = 0;
    const lang = v.lang.replace('_', '-');
    if (lang.toLowerCase() === accent.toLowerCase()) s += 100;
    else if (lang.toLowerCase().startsWith(accent.slice(0, 2).toLowerCase())) s += 10;
    if (/natural|neural|online/i.test(v.name)) s += 40;
    if (/google|siri|samantha|daniel|aria|jenny|guy|libby|sonia|ryan|alex|karen/i.test(v.name)) s += 20;
    if (v.localService) s += 5;
    return s;
  }
  function list() { return voices.slice(); }
  function pick(accent, voiceName) {
    if (voiceName) {
      const f = voices.find((v) => v.voiceURI === voiceName || v.name === voiceName);
      if (f) return f;
    }
    if (!voices.length) return null;
    return voices.slice().sort((a, b) => score(b, accent) - score(a, accent))[0];
  }

  let seq = 0;
  let keep = null; // ссылка на говорящую фразу: иначе Safari может «собрать» её до конца речи и оборвать звук
  const state = { lastError: '' };

  // Голоса на iPhone иногда подгружаются без события voiceschanged — проверяем несколько раз после запуска
  if (ok) {
    let n = 0;
    const t = setInterval(() => {
      const before = voices.length;
      load();
      if (voices.length !== before && EW.tts && EW.tts.onchange) EW.tts.onchange();
      if (voices.length || ++n > 20) clearInterval(t);
    }, 250);
  }

  function say(u, my, resolve) {
    u.onend = () => resolve(true);
    u.onerror = (e) => {
      const err = (e && e.error) || 'error';
      if (err !== 'canceled' && err !== 'interrupted') state.lastError = err;
      resolve(false);
    };
    keep = u;
    syn.speak(u);
  }

  // speak(text, {accent, voice, rate}) → Promise, завершается, когда речь закончилась (или не получилась).
  // Первая фраза должна запускаться прямо из нажатия: iPhone не разрешает озвучивание «по таймеру» без касания.
  function speak(text, o) {
    o = o || {};
    return new Promise((resolve) => {
      if (!ok || !text) return resolve(false);
      try {
        state.lastError = '';
        if (!voices.length) load();
        const my = ++seq;
        const u = new SpeechSynthesisUtterance(String(text));
        const accent = o.accent || 'en-US';
        const v = pick(accent, o.voice);
        u.lang = v ? v.lang : accent;
        if (v) u.voice = v;
        u.rate = Math.min(1.5, Math.max(0.4, o.rate || 0.9));
        u.volume = 1;
        if (syn.speaking || syn.pending) {
          // предыдущая фраза ещё звучит: останавливаем её; у части браузеров «cancel» и «speak» подряд теряют вторую фразу, поэтому пауза
          syn.cancel();
          setTimeout(() => { if (my === seq) say(u, my, resolve); else resolve(false); }, 60);
        } else {
          say(u, my, resolve);
        }
      } catch (e) {
        state.lastError = String((e && e.name) || 'error');
        resolve(false);
      }
    });
  }
  function stop() { if (ok) try { syn.cancel(); } catch (e) { /* ignore */ } }

  // «Разблокировка»: при первом касании тихо произносим пустую фразу, после этого iPhone разрешает озвучивать и без прямого касания
  let unlocked = false;
  function unlock() {
    if (unlocked || !ok) return;
    unlocked = true;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      syn.speak(u);
    } catch (e) { /* ignore */ }
  }
  if (ok && typeof document !== 'undefined') {
    document.addEventListener('pointerdown', unlock, { capture: true, once: true });
    document.addEventListener('keydown', unlock, { capture: true, once: true });
  }

  EW.tts = { supported: ok, speak, stop, list, pick, load, state };
})();

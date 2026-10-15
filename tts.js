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
  // speak(text, {accent, voice, rate}) → Promise, завершается, когда речь закончилась (или не получилась)
  function speak(text, o) {
    o = o || {};
    return new Promise((resolve) => {
      if (!ok || !text) return resolve(false);
      try {
        syn.cancel();
        const my = ++seq;
        const u = new SpeechSynthesisUtterance(String(text));
        const accent = o.accent || 'en-US';
        const v = pick(accent, o.voice);
        u.lang = v ? v.lang : accent;
        if (v) u.voice = v;
        u.rate = Math.min(1.5, Math.max(0.4, o.rate || 0.9));
        u.onend = () => resolve(true);
        u.onerror = () => resolve(false);
        // у части браузеров «cancel» и «speak» подряд теряют вторую фразу
        setTimeout(() => { if (my === seq) syn.speak(u); else resolve(false); }, 30);
      } catch (e) {
        resolve(false);
      }
    });
  }
  function stop() { if (ok) try { syn.cancel(); } catch (e) { /* ignore */ } }

  EW.tts = { supported: ok, speak, stop, list, pick, load };
})();

/* Eng word — ядро: состояние, хранение, слияние по записям. */
(function () {
  'use strict';
  const EW = (window.EW = window.EW || {});

  const COLLS = ['words', 'files', 'days', 'dicts'];
  const LS_META = 'ew.meta.v1';
  const LS_STATE = 'ew.state.v1'; // запасной вариант, если IndexedDB недоступна
  const TOMB_TTL = 90 * 864e5;

  function defaults() {
    return { v: 1, settings: { u: 0, newPerDay: 10, dirs: { f: true, b: true } }, words: [], files: [], days: [], dicts: [] };
  }
  function normalize(s) {
    const d = defaults();
    s = s && typeof s === 'object' ? s : d;
    s.v = 1;
    s.settings = Object.assign({}, d.settings, s.settings || {});
    s.settings.dirs = Object.assign({}, d.settings.dirs, s.settings.dirs || {});
    for (const c of COLLS) if (!Array.isArray(s[c])) s[c] = [];
    ensureDicts(s);
    return s;
  }
  // Всегда должен быть хотя бы один словарь. «Основной» создаётся с u = 0: любая настоящая запись с другого устройства его перекроет.
  function ensureDicts(s) {
    if (s.dicts.some((d) => !d.d)) return false;
    const i = s.dicts.findIndex((d) => d.id === 'main');
    const m = { id: 'main', name: 'Основной', c: 0, u: i >= 0 ? (s.dicts[i].u || 0) + 1 : 0 };
    if (i >= 0) s.dicts[i] = m; else s.dicts.push(m);
    return true;
  }

  const metaDefaults = { signedIn: false, dirty: false, lastSync: 0, rv: '', voice: '', cur: '', accent: 'en-US', rate: 0.9, autoSpeak: true };
  function loadMeta() {
    try { return Object.assign({}, metaDefaults, JSON.parse(localStorage.getItem(LS_META) || '{}')); } catch (e) { return Object.assign({}, metaDefaults); }
  }

  const core = (EW.core = {
    COLLS,
    S: defaults(),
    meta: loadMeta(),
    rev: 0, // счётчик изменений: нужен, чтобы синхронизация не сбрасывала dirty, если данные поменялись во время отправки
    hooks: { changed() {}, scheduleSync() {} },
    useLS: false,
  });

  /* ---------- IndexedDB ---------- */
  let dbp = null;
  function idb() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        if (!window.indexedDB) return rej(new Error('no idb'));
        const r = indexedDB.open('ew-db', 1);
        r.onupgradeneeded = () => {
          const d = r.result;
          d.createObjectStore('kv');
          d.createObjectStore('blobs');
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
        r.onblocked = () => rej(new Error('blocked'));
      });
    }
    return dbp;
  }
  function tx(store, mode, fn) {
    return idb().then(
      (d) =>
        new Promise((res, rej) => {
          const t = d.transaction(store, mode);
          const st = t.objectStore(store);
          let out;
          try { out = fn(st); } catch (e) { rej(e); return; }
          t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
          t.onerror = () => rej(t.error);
          t.onabort = () => rej(t.error);
        })
    );
  }
  core.kvGet = (k) => tx('kv', 'readonly', (s) => s.get(k));
  core.kvSet = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));
  core.blobGet = (k) => tx('blobs', 'readonly', (s) => s.get(k));
  core.blobSet = (k, v) => tx('blobs', 'readwrite', (s) => s.put(v, k));
  core.blobDel = (k) => tx('blobs', 'readwrite', (s) => s.delete(k));
  core.blobKeys = () => tx('blobs', 'readonly', (s) => s.getAllKeys());
  core.blobStats = async () => {
    const d = await idb();
    return new Promise((res, rej) => {
      const t = d.transaction('blobs', 'readonly');
      let n = 0, size = 0;
      const rq = t.objectStore('blobs').openCursor();
      rq.onsuccess = () => {
        const c = rq.result;
        if (c) { n++; size += (c.value && c.value.blob && c.value.blob.size) || 0; c.continue(); } else res({ n, size });
      };
      rq.onerror = () => rej(rq.error);
    });
  };
  core.blobClear = () => tx('blobs', 'readwrite', (s) => s.clear());

  /* ---------- загрузка / сохранение ---------- */
  core.init = async function () {
    let st = null;
    try {
      st = await core.kvGet('state');
    } catch (e) {
      core.useLS = true;
    }
    if (!st) {
      try {
        const raw = localStorage.getItem(LS_STATE);
        if (raw) st = JSON.parse(raw);
      } catch (e) { /* ignore */ }
    }
    core.S = normalize(st);
    return core.S;
  };

  // Запись начинается сразу (чтобы данные не потерялись, если вкладку закроют), а пока идёт одна запись,
  // следующие сливаются в одну — берётся самое свежее состояние.
  let writing = null, again = false;
  function writeOnce() {
    const snap = core.S;
    if (core.useLS) {
      try { localStorage.setItem(LS_STATE, JSON.stringify(snap)); } catch (e) { core.hooks.error && core.hooks.error('Не хватает места для сохранения на устройстве'); }
      return Promise.resolve();
    }
    return core.kvSet('state', snap).catch(() => {
      core.hooks.error && core.hooks.error('Не удалось сохранить данные на устройстве');
    });
  }
  core.persist = function () {
    if (writing) { again = true; return writing; }
    const loop = () =>
      writeOnce().then(() => {
        if (again) { again = false; return loop(); }
        writing = null;
      });
    writing = loop();
    return writing;
  };
  core.flush = () => core.persist();
  core.saveMeta = function () {
    try { localStorage.setItem(LS_META, JSON.stringify(core.meta)); } catch (e) { /* ignore */ }
  };

  /* ---------- утилиты ---------- */
  core.uid = () => Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 9);
  core.live = (c) => core.S[c].filter((x) => !x.d);
  // К какому словарю относится слово. Слова без словаря (старые данные) и слова удалённого словаря попадают в «Основной».
  core.dictResolver = function () {
    const ds = core.S.dicts.filter((d) => !d.d);
    const ok = new Set(ds.map((d) => d.id));
    const fb = ok.has('main') ? 'main' : ds.length ? ds[0].id : 'main';
    return (w) => (w.dict && ok.has(w.dict) ? w.dict : fb);
  };
  core.dictId = (w) => core.dictResolver()(w);
  core.get = (c, id) => core.S[c].find((x) => x.id === id);
  core.upsert = function (c, obj) {
    obj.u = Date.now();
    const i = core.S[c].findIndex((x) => x.id === obj.id);
    if (i < 0) core.S[c].push(obj); else core.S[c][i] = obj;
    return obj;
  };
  core.tomb = function (c, id, extra) {
    const i = core.S[c].findIndex((x) => x.id === id);
    if (i >= 0) core.S[c][i] = Object.assign({ id, d: true, u: Date.now() }, extra || {});
  };
  core.setSettings = function (patch) {
    core.S.settings = Object.assign({}, core.S.settings, patch);
    core.S.settings.u = Date.now();
  };
  // Любое изменение данных проходит через commit()
  core.commit = function () {
    core.rev++;
    core.meta.dirty = true;
    core.saveMeta();
    core.persist();
    core.hooks.changed();
    core.hooks.scheduleSync();
  };

  /* ---------- слияние: побеждает запись с более поздним u ---------- */
  core.mergeState = function (L, R) {
    let pushNeeded = false, pullChanged = false;
    R = normalize(R);
    const now = Date.now();
    for (const c of COLLS) {
      const lm = new Map((L[c] || []).map((x) => [x.id, x]));
      const rm = new Map((R[c] || []).map((x) => [x.id, x]));
      for (const [id, rx] of rm) {
        const lx = lm.get(id);
        if (!lx || (rx.u || 0) > (lx.u || 0)) { lm.set(id, rx); pullChanged = true; }
      }
      for (const [id, lx] of lm) {
        const rx = rm.get(id);
        if (!rx || (lx.u || 0) > (rx.u || 0)) pushNeeded = true;
      }
      L[c] = [...lm.values()].filter((x) => !(x.d && !x.driveId && now - (x.u || 0) > TOMB_TTL));
    }
    if (ensureDicts(L)) pushNeeded = true;
    const ru = (R.settings && R.settings.u) || 0;
    const lu = L.settings.u || 0;
    if (ru > lu) { L.settings = Object.assign({}, defaults().settings, R.settings); pullChanged = true; }
    else if (lu > ru) pushNeeded = true;
    return { pushNeeded, pullChanged };
  };

  core.normalize = normalize;
  core.ensureDicts = ensureDicts;
  core.defaults = defaults;
})();

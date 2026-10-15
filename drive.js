/* English Words — вход через Google (GIS, token flow) и синхронизация с appDataFolder на Google Drive. Бэкенда нет. */
(function () {
  'use strict';
  const EW = (window.EW = window.EW || {});
  const core = EW.core;
  const M = core.meta;

  const CLIENT_ID = '388313004732-6d9ffdu8250ktkfl7iu3fd6bduuq6ndq.apps.googleusercontent.com';
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const DATA_NAME = 'eng-word-data.json';
  const LS_TOKEN = 'ew.token.v1';
  const LS_FID = 'ew.fileid.v1';
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const CHUNK = 8 * 1024 * 1024; // кратно 256 КБ, как требует Google
  const SMALL = 4 * 1024 * 1024; // до этого размера грузим одним запросом
  const AUTO_CACHE_MAX = 25 * 1024 * 1024; // файлы меньше этого сохраняем на устройстве сами
  const MAX_FILE = 300 * 1024 * 1024;

  const D = (EW.drive = { MAX_FILE, AUTO_CACHE_MAX, CLIENT_ID });

  /* ---------- статус ---------- */
  // k: local | sync | ok | authneeded | offline | error
  D.status = { k: M.signedIn ? 'ok' : 'local', msg: '' };
  function setStatus(k, msg) {
    D.status = { k, msg: msg || '' };
    D.onstatus && D.onstatus(D.status);
  }
  D.setStatus = setStatus;

  class DriveError extends Error {
    constructor(code, msg, http) { super(msg); this.code = code; this.http = http; }
  }
  function describe(e) {
    if (e instanceof DriveError) return e;
    if (e && e.name === 'TypeError') return new DriveError('OFFLINE', 'Нет соединения с интернетом');
    return new DriveError('ERR', (e && e.message) || 'Неизвестная ошибка');
  }

  /* ---------- токен ---------- */
  let token = null, tokenExp = 0, tokenClient = null, gisLoading = null, tokenPromise = null, pending = null;
  try {
    const t = JSON.parse(localStorage.getItem(LS_TOKEN) || 'null');
    if (t && t.t && t.exp > Date.now() + 60000) { token = t.t; tokenExp = t.exp; }
  } catch (e) { /* ignore */ }
  const tokenValid = () => !!token && Date.now() < tokenExp - 60000;
  D.tokenValid = tokenValid;
  function forgetToken() {
    token = null; tokenExp = 0;
    try { localStorage.removeItem(LS_TOKEN); } catch (e) { /* ignore */ }
  }

  // Скрипт Google подгружается лениво — только когда нужен вход
  function loadGIS() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
    if (gisLoading) return gisLoading;
    gisLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => res();
      s.onerror = () => { gisLoading = null; rej(new DriveError('OFFLINE', 'Не удалось загрузить вход Google. Проверьте интернет')); };
      document.head.appendChild(s);
    });
    return gisLoading;
  }
  D.preload = () => { loadGIS().catch(() => {}); };

  function ensureClient() {
    if (tokenClient) return;
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (r) => {
        if (r && r.access_token) {
          token = r.access_token;
          tokenExp = Date.now() + (+r.expires_in || 3600) * 1000;
          try { localStorage.setItem(LS_TOKEN, JSON.stringify({ t: token, exp: tokenExp })); } catch (e) { /* ignore */ }
          const p = pending; pending = null;
          p && p.res(token);
        } else {
          const p = pending; pending = null;
          p && p.rej(new DriveError('AUTH', (r && (r.error_description || r.error)) || 'Вход не выполнен'));
        }
      },
      error_callback: (e) => {
        const p = pending; pending = null;
        p && p.rej(new DriveError('AUTH', e && e.type === 'popup_closed' ? 'Окно входа закрыто' : 'Не удалось открыть окно входа Google'));
      },
    });
  }

  // Запрашивать токен можно только по жесту пользователя (касание, клик)
  function getToken() {
    if (tokenValid()) return Promise.resolve(token);
    if (tokenPromise) return tokenPromise;
    tokenPromise = loadGIS()
      .then(
        () =>
          new Promise((res, rej) => {
            ensureClient();
            pending = { res, rej };
            const timer = setTimeout(() => { if (pending) { pending = null; rej(new DriveError('AUTH', 'Время ожидания входа истекло')); } }, 120000);
            const done = () => clearTimeout(timer);
            pending.res = (v) => { done(); res(v); };
            pending.rej = (e) => { done(); rej(e); };
            tokenClient.requestAccessToken({ prompt: '' });
          })
      )
      .finally(() => { tokenPromise = null; });
    return tokenPromise;
  }
  D.getToken = getToken;

  D.signIn = async function () {
    try {
      await getToken();
      M.signedIn = true;
      core.saveMeta();
      setStatus('sync');
      try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { /* ignore */ }
      await D.syncNow();
      return true;
    } catch (e) {
      const d = describe(e);
      setStatus(M.signedIn ? 'authneeded' : 'local', d.message);
      throw d;
    }
  };
  D.signOut = function () {
    const t = token;
    forgetToken();
    M.signedIn = false; M.rv = '';
    try { localStorage.removeItem(LS_FID); } catch (e) { /* ignore */ }
    core.saveMeta();
    try { if (t && window.google && window.google.accounts) window.google.accounts.oauth2.revoke(t, () => {}); } catch (e) { /* ignore */ }
    setStatus('local');
  };

  /* ---------- запросы к Drive ---------- */
  async function gfetch(url, opts) {
    if (!tokenValid()) throw new DriveError('AUTH', 'Нужно войти в Google');
    opts = Object.assign({}, opts);
    opts.headers = Object.assign({}, opts.headers, { Authorization: 'Bearer ' + token });
    let r;
    try { r = await fetch(url, opts); } catch (e) { throw new DriveError('OFFLINE', 'Нет соединения с интернетом'); }
    if (r.status === 401) { forgetToken(); throw new DriveError('AUTH', 'Нужно войти в Google', 401); }
    return r;
  }
  async function failFrom(r, what) {
    let reason = '';
    try { const j = await r.clone().json(); reason = (j.error && (j.error.errors && j.error.errors[0] && j.error.errors[0].reason || j.error.message)) || ''; } catch (e) { /* ignore */ }
    if (r.status === 403 && /quota|storage/i.test(reason)) return new DriveError('QUOTA', 'Не хватает места на Google Drive', 403);
    if (r.status === 403 || r.status === 429) return new DriveError('LIMIT', 'Google временно ограничил запросы. Повторим позже', r.status);
    if (r.status >= 500) return new DriveError('SERVER', 'Сервер Google недоступен. Повторим позже', r.status);
    return new DriveError('HTTP', (what || 'Ошибка Drive') + ' (' + r.status + ')', r.status);
  }

  async function findDataFile() {
    const cached = localStorage.getItem(LS_FID);
    const q = encodeURIComponent("name='" + DATA_NAME + "' and 'appDataFolder' in parents and trashed=false");
    const r = await gfetch(API + '/files?spaces=appDataFolder&pageSize=10&fields=files(id,version)&q=' + q);
    if (!r.ok) throw await failFrom(r, 'Не удалось найти файл данных');
    const j = await r.json();
    const files = j.files || [];
    if (!files.length) { localStorage.removeItem(LS_FID); return null; }
    const f = files.find((x) => x.id === cached) || files[0];
    localStorage.setItem(LS_FID, f.id);
    return f;
  }
  async function downloadJSON(id) {
    const r = await gfetch(API + '/files/' + id + '?alt=media');
    if (r.status === 404) { localStorage.removeItem(LS_FID); return null; }
    if (!r.ok) throw await failFrom(r, 'Не удалось скачать данные');
    return r.json();
  }

  // Загрузка по частям (resumable) — для больших файлов и видео
  async function resumableUpload(method, path, meta, blob, onProgress) {
    const init = await gfetch(UPLOAD + path + (path.includes('?') ? '&' : '?') + 'uploadType=resumable&fields=id,version,size', {
      method,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': blob.type || 'application/octet-stream', 'X-Upload-Content-Length': String(blob.size) },
      body: JSON.stringify(meta || {}),
    });
    if (!init.ok) throw await failFrom(init, 'Не удалось начать загрузку');
    const loc = init.headers.get('Location');
    if (!loc) throw new DriveError('HTTP', 'Google не вернул адрес загрузки');
    const total = blob.size;
    let pos = 0, fails = 0;
    if (total === 0) {
      const r0 = await fetch(loc, { method: 'PUT', headers: { 'Content-Length': '0' } });
      if (!r0.ok) throw await failFrom(r0);
      return r0.json();
    }
    while (pos < total) {
      const end = Math.min(pos + CHUNK, total);
      let r;
      try {
        r = await fetch(loc, { method: 'PUT', headers: { 'Content-Range': 'bytes ' + pos + '-' + (end - 1) + '/' + total }, body: blob.slice(pos, end) });
      } catch (e) {
        // обрыв связи: спрашиваем у Google, сколько уже принято, и продолжаем
        if (++fails > 6) throw new DriveError('OFFLINE', 'Нет соединения с интернетом');
        await new Promise((res) => setTimeout(res, 1000 * fails));
        try {
          const st = await fetch(loc, { method: 'PUT', headers: { 'Content-Range': 'bytes */' + total } });
          if (st.status === 308) {
            const rg = st.headers.get('Range');
            pos = rg ? parseInt(rg.split('-')[1], 10) + 1 : 0;
          } else if (st.ok) { return st.json(); }
        } catch (e2) { /* повторим цикл */ }
        continue;
      }
      if (r.status === 308) {
        const rg = r.headers.get('Range');
        pos = rg ? parseInt(rg.split('-')[1], 10) + 1 : end;
        fails = 0;
        onProgress && onProgress(Math.min(1, pos / total));
        continue;
      }
      if (r.ok) { onProgress && onProgress(1); return r.json(); }
      if (r.status >= 500 && ++fails <= 6) { await new Promise((res) => setTimeout(res, 1000 * fails)); continue; }
      throw await failFrom(r, 'Ошибка при загрузке файла');
    }
    throw new DriveError('HTTP', 'Загрузка не завершилась');
  }

  async function multipartCreate(meta, blob) {
    const boundary = 'ewb' + Math.random().toString(36).slice(2);
    const head = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + boundary + '\r\nContent-Type: ' + (blob.type || 'application/octet-stream') + '\r\n\r\n';
    const body = new Blob([head, blob, '\r\n--' + boundary + '--']);
    const r = await gfetch(UPLOAD + '/files?uploadType=multipart&fields=id,version,size', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
    if (!r.ok) throw await failFrom(r, 'Не удалось создать файл');
    return r.json();
  }
  async function mediaUpdate(id, blob) {
    const r = await gfetch(UPLOAD + '/files/' + id + '?uploadType=media&fields=id,version', { method: 'PATCH', headers: { 'Content-Type': blob.type || 'application/json' }, body: blob });
    if (r.status === 404) return null;
    if (!r.ok) throw await failFrom(r, 'Не удалось сохранить данные');
    return r.json();
  }

  async function uploadState(fid, json) {
    const blob = new Blob([json], { type: 'application/json' });
    if (fid) {
      let res;
      if (blob.size > SMALL) res = await resumableUpload('PATCH', '/files/' + fid, {}, blob);
      else res = await mediaUpdate(fid, blob);
      if (res) return { id: fid, version: res.version };
      localStorage.removeItem(LS_FID); // файл удалили — создадим заново
    }
    const meta = { name: DATA_NAME, parents: ['appDataFolder'], mimeType: 'application/json' };
    const res = blob.size > SMALL ? await resumableUpload('POST', '/files', meta, blob) : await multipartCreate(meta, blob);
    localStorage.setItem(LS_FID, res.id);
    return { id: res.id, version: res.version };
  }

  /* ---------- вложения ---------- */
  D.uploadAttachment = async function (file, onProgress) {
    if (file.size > MAX_FILE) throw new DriveError('BIG', 'Файл слишком большой (максимум ' + Math.round(MAX_FILE / 1048576) + ' МБ)');
    const meta = { name: 'att-' + core.uid(), parents: ['appDataFolder'], properties: { orig: file.name.slice(0, 100) } };
    const blob = file.type ? file : new Blob([file], { type: 'application/octet-stream' });
    const res = file.size > SMALL ? await resumableUpload('POST', '/files', meta, blob, onProgress) : (onProgress && onProgress(0.3), await multipartCreate(meta, blob));
    onProgress && onProgress(1);
    return { driveId: res.id };
  };

  async function downloadBlob(driveId, mime, onProgress) {
    const r = await gfetch(API + '/files/' + driveId + '?alt=media');
    if (r.status === 404) throw new DriveError('GONE', 'Файл не найден на Google Drive');
    if (!r.ok) throw await failFrom(r, 'Не удалось скачать файл');
    const total = +r.headers.get('Content-Length') || 0;
    if (!r.body || !r.body.getReader || !total) {
      const b = await r.blob();
      return new Blob([b], { type: mime || b.type });
    }
    const rd = r.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      parts.push(value); got += value.length;
      onProgress && onProgress(Math.min(1, got / total));
    }
    return new Blob(parts, { type: mime || 'application/octet-stream' });
  }

  // Возвращает Blob: сначала из памяти устройства, иначе скачивает с Drive
  D.getFileBlob = async function (rec, onProgress, forceCache) {
    if (!rec.driveId) throw new DriveError('GONE', 'Файл не найден');
    try {
      const hit = await core.blobGet(rec.driveId);
      if (hit && hit.blob) return hit.blob;
    } catch (e) { /* кэш недоступен */ }
    if (!tokenValid()) {
      if (!M.signedIn) throw new DriveError('AUTH', 'Файл не скачан на это устройство. Войдите в Google и подключите интернет');
      await getToken().catch(() => { throw new DriveError('AUTH', 'Нужно войти в Google, чтобы скачать файл'); });
    }
    const blob = await downloadBlob(rec.driveId, rec.mime, onProgress);
    if (forceCache || blob.size <= AUTO_CACHE_MAX) await D.cacheFile(rec, blob).catch(() => {});
    return blob;
  };
  D.cacheFile = (rec, blob) => core.blobSet(rec.driveId, { blob, name: rec.name, mime: rec.mime, t: Date.now() });
  D.isCached = async (rec) => {
    try { return !!(rec.driveId && (await core.blobGet(rec.driveId))); } catch (e) { return false; }
  };
  D.uncache = (rec) => (rec.driveId ? core.blobDel(rec.driveId).catch(() => {}) : Promise.resolve());

  // Файлы, удалённые пользователем: стираем на Drive и снимаем driveId у «надгробия»
  async function purgeDriveFiles() {
    let changed = false;
    for (const f of core.S.files) {
      if (f.d && f.driveId) {
        const r = await gfetch(API + '/files/' + f.driveId, { method: 'DELETE' });
        if (r.ok || r.status === 404 || r.status === 204) {
          await core.blobDel(f.driveId).catch(() => {});
          f.driveId = '';
          delete f.driveId;
          f.u = Date.now();
          changed = true;
        } else if (r.status !== 403) {
          throw await failFrom(r, 'Не удалось удалить файл на Drive');
        }
      }
    }
    return changed;
  }

  /* ---------- синхронизация ---------- */
  let syncing = false, syncAgain = false, syncTimer = 0, retryTimer = 0;
  D.isSyncing = () => syncing;

  core.hooks.scheduleSync = function () {
    if (!M.signedIn) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => D.syncNow(), 1200); // дебаунс 1,2 с
  };

  function fail(e) {
    const d = describe(e);
    if (d.code === 'AUTH') setStatus('authneeded', 'Нужен вход в Google: коснитесь экрана');
    else if (d.code === 'OFFLINE') setStatus('offline', 'Нет соединения с интернетом');
    else setStatus('error', d.message);
    if (d.code !== 'AUTH' && M.dirty && ['OFFLINE', 'SERVER', 'LIMIT'].includes(d.code)) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => D.syncNow(), 60000);
    }
    return d;
  }

  D.syncNow = async function (opt) {
    opt = opt || {};
    if (!M.signedIn) return false;
    if (syncing) { syncAgain = true; return false; }
    syncing = true; syncAgain = false;
    setStatus('sync');
    let pulled = false, ok = false;
    try {
      if (!tokenValid()) {
        if (opt.interactive) await getToken();
        else throw new DriveError('AUTH', 'Нужно войти в Google');
      }
      let f = await findDataFile();
      let remote = null, push = false;
      if (f && (M.dirty || f.version !== M.rv)) {
        remote = await downloadJSON(f.id);
        if (!remote) f = null;
      }
      if (remote) {
        const r = core.mergeState(core.S, remote);
        push = r.pushNeeded;
        pulled = r.pullChanged;
      }
      if (await purgeDriveFiles()) push = true;
      let version = f ? f.version : '';
      if (M.dirty || push || !f) {
        const mark = core.rev;
        const res = await uploadState(f && f.id, JSON.stringify(core.S));
        version = res.version;
        if (core.rev === mark) M.dirty = false; else syncAgain = true;
      }
      M.rv = version || '';
      M.lastSync = Date.now();
      core.saveMeta();
      if (pulled) { core.persist(); core.hooks.changed(); } else if (!M.dirty) core.persist();
      setStatus('ok');
      ok = true;
    } catch (e) {
      fail(e);
    } finally {
      syncing = false;
    }
    if (syncAgain && M.signedIn) { syncAgain = false; setTimeout(() => D.syncNow(), 50); }
    return ok;
  };

  /* ---------- когда запускать синхронизацию ---------- */
  D.start = function () {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && M.signedIn && tokenValid() && Date.now() - (M.lastSync || 0) > 30000) D.syncNow();
      if (document.visibilityState === 'hidden') core.flush();
    });
    window.addEventListener('pagehide', () => core.flush());
    window.addEventListener('online', () => { if (M.signedIn && M.dirty) D.syncNow(); });
    window.addEventListener('offline', () => { if (M.signedIn) setStatus('offline', 'Нет соединения с интернетом'); });

    // Обновление токена только по жесту: на мобильных — по pointerup (отпускание пальца)
    let authTry = 0;
    document.addEventListener('pointerup', () => {
      if (!M.signedIn || tokenPromise || tokenValid() || Date.now() - authTry < 30000) return;
      authTry = Date.now();
      getToken().then(() => D.syncNow(), () => setStatus('authneeded', 'Нужен вход в Google: нажмите «Синхронизировать»'));
    });

    if (!M.signedIn) { setStatus('local'); return; }
    D.preload(); // чтобы по первому касанию можно было сразу обновить токен
    if (tokenValid()) D.syncNow(); else setStatus('authneeded', 'Нужен вход в Google: коснитесь экрана');
  };
})();

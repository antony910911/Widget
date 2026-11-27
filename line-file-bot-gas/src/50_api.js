/**
 * 網頁介面透過 google.script.run 呼叫的函式。
 * 每一個（除了登入相關）第一個參數都是登入 token，並先檢查。
 */
function apiSession(token) {
  return { configured: passwordConfigured_(), loggedIn: isLoggedIn_(token) };
}
function apiSetup(password) {
  if (passwordConfigured_()) throw new Error('已經設定過密碼了');
  if (String(password || '').length < 6) throw new Error('密碼至少 6 個字');
  setPassword_(password);
  getWebhookKey_();
  Db.ss(); // 第一次使用：建立資料夾與試算表
  logActivity_('info', '已建立管理密碼');
  return newSession_();
}
function apiLogin(password) {
  if (loginThrottle_()) throw new Error('嘗試太多次，請 15 分鐘後再試');
  if (!checkPassword_(password)) { loginThrottle_(true); throw new Error('密碼錯誤'); }
  loginThrottle_(false);
  return newSession_();
}
function apiLogout(token) {
  const s = Props.getJson('SESSIONS', {});
  delete s[token];
  Props.setJson('SESSIONS', s);
  return true;
}

// ---------- 檔案 ----------
function apiFiles(token) {
  requireAuth_(token);
  const rules = getRules_();
  const files = Db.all().map(f => Object.assign(f, { icon: Classifier.iconFor(f.category, rules) }));
  return { files: files, categories: Classifier.categoryList(rules), sheetUrl: Db.ss().getUrl() };
}
function apiThumbs(token, ids) {
  requireAuth_(token);
  const cache = CacheService.getScriptCache();
  const want = (ids || []).slice(0, 24);
  const hit = cache.getAll(want.map(id => 'th_' + id));
  const out = {};
  const byId = {};
  Db.all().forEach(f => { byId[f.id] = f; });
  want.forEach(id => {
    if (hit['th_' + id]) { out[id] = hit['th_' + id] === '-' ? null : hit['th_' + id]; return; }
    const f = byId[id];
    let url = null;
    try { const s = f && STORAGE_PROVIDERS[f.storage]; if (s && s.isReady() && s.thumbnail) url = s.thumbnail(f); } catch (e) {}
    out[id] = url;
    // OneDrive 的縮圖網址會過期，只快取 30 分鐘；data URL 太大就不快取
    if (!url || url.length < 90000) cache.put('th_' + id, url || '-', 1800);
  });
  return out;
}
function apiUpdateFile(token, id, patch) {
  requireAuth_(token);
  const found = Db.findRow(id);
  if (!found) throw new Error('找不到這個檔案');
  const rec = found.rec;
  if (Array.isArray(patch.tags)) {
    rec.tags = patch.tags.map(t => String(t).replace(/,/g, ' ').trim().slice(0, 40)).filter((t, i, a) => t && a.indexOf(t) === i).slice(0, 50);
  }
  const rules = getRules_();
  const newCat = patch.category && patch.category !== rec.category ? patch.category : null;
  const newName = patch.name ? sanitizeName_(patch.name) : null;
  if (newCat || (newName && newName !== rec.name)) {
    if (newCat && !Classifier.categoryList(rules).some(c => c.name === newCat)) throw new Error('沒有這個分類');
    const sub = splitPath_(rec.folder).slice(1).join('/');
    const folder = newCat ? joinPath_(sanitizeFolder_(newCat), sub) : rec.folder;
    const moved = storageFor_(rec).move(rec, folder, newName || rec.name);
    if (newCat) {
      const i = rec.tags.indexOf(rec.category);
      if (i >= 0) rec.tags[i] = newCat; else rec.tags.push(newCat);
      rec.tags = rec.tags.filter((t, j, a) => a.indexOf(t) === j);
      rec.category = newCat;
    }
    Object.assign(rec, { folder: folder, fileId: moved.fileId, path: moved.path, url: moved.url, name: moved.path.split('/').pop() });
    rec.ext = getExt_(rec.name);
  }
  Db.update(found.row, rec);
  return Object.assign(rec, { icon: Classifier.iconFor(rec.category, rules) });
}
function apiDeleteFile(token, id) {
  requireAuth_(token);
  const found = Db.findRow(id);
  if (!found) throw new Error('找不到這個檔案');
  try { storageFor_(found.rec).remove(found.rec); } catch (e) { if (!/not found|404|找不到/i.test(e.message)) throw e; }
  Db.remove(found.row);
  return true;
}

// ---------- 設定 ----------
function apiSettings(token) {
  requireAuth_(token);
  const t = Props.get('LINE_TOKEN', '');
  const active = activeStorage_();
  return {
    webhookUrl: getWebhookUrl_(),
    lineTokenSet: Boolean(t),
    lineTokenHint: t ? '••••••••' + t.slice(-4) : '',
    replyOnSave: Props.get('REPLY_ON_SAVE') === 'true',
    rootFolder: rootFolderName_(),
    rules: getRules_(),
    storage: active.id,
    storages: STORAGE_ORDER.map(id => {
      const s = STORAGE_PROVIDERS[id];
      return { id: id, label: s.label, ready: s.isReady(), account: s.isReady() && s.account ? s.account() : '' };
    }),
    onedriveClientId: Props.get('OD_CLIENT_ID', ''),
    dropboxAppKey: Props.get('DBX_KEY', ''),
    sheetUrl: Db.ss().getUrl(),
  };
}
function apiSaveSettings(token, patch) {
  requireAuth_(token);
  if (typeof patch.lineToken === 'string' && patch.lineToken.trim()) { Props.set('LINE_TOKEN', patch.lineToken.trim()); logActivity_('info', '已更新 LINE 金鑰'); }
  if (typeof patch.replyOnSave === 'boolean') Props.set('REPLY_ON_SAVE', String(patch.replyOnSave));
  if (patch.rules === null) { Props.set('RULES', null); logActivity_('info', '已還原預設分類規則'); }
  else if (patch.rules) { Props.setJson('RULES', validateRules_(patch.rules)); logActivity_('info', '已更新分類規則'); }
  if (typeof patch.rootFolder === 'string') {
    const name = sanitizeFolder_(patch.rootFolder);
    if (name !== rootFolderName_()) {
      try { STORAGE_PROVIDERS.gdrive.renameRoot(name); } catch (e) {}
      Props.set('ROOT_FOLDER', name);
      logActivity_('info', '根資料夾改名為「' + name + '」（只影響之後存入 OneDrive / Dropbox 的檔案位置）');
    }
  }
  return true;
}
function apiChangePassword(token, current, next) {
  requireAuth_(token);
  if (!checkPassword_(current)) throw new Error('目前的密碼不正確');
  if (String(next || '').length < 6) throw new Error('新密碼至少 6 個字');
  setPassword_(next);
  logActivity_('info', '已變更管理密碼');
  return newSession_();
}
function apiTestLine(token) {
  requireAuth_(token);
  if (!Line.token()) return { ok: false, error: '尚未填寫 Channel access token' };
  try {
    const bot = Line.botInfo();
    let webhook = null;
    try { webhook = Line.webhookEndpoint(); } catch (e) {}
    const res = { ok: true, bot: { name: bot.displayName, basicId: bot.basicId, pictureUrl: bot.pictureUrl }, webhook: webhook };
    Props.set('LINE_OK', 'true');
    return res;
  } catch (e) {
    Props.set('LINE_OK', null);
    return { ok: false, error: e.message };
  }
}
function apiActivity(token) {
  requireAuth_(token);
  const sh = Db.ss().getSheetByName(LOG_SHEET);
  const n = Math.min(sh.getLastRow() - 1, 100);
  const rows = n > 0 ? sh.getRange(2, 1, n, 3).getValues() : [];
  return {
    entries: rows.map(r => ({ at: r[0] instanceof Date ? r[0].toISOString() : String(r[0]), level: String(r[1]), msg: String(r[2]) })),
    lastWebhookAt: Props.get('LAST_WEBHOOK_AT', ''),
    lastFileAt: Props.get('LAST_FILE_AT', ''),
    groups: Props.getJson('GROUPS', {}),
    totalFiles: Math.max(0, Db.sheet().getLastRow() - 1),
  };
}
function apiReclassify(token) {
  requireAuth_(token);
  const rules = getRules_();
  const known = {};
  Classifier.categoryList(rules).forEach(c => { known[c.name] = true; });
  const values = Db.sheet().getDataRange().getValues();
  let moved = 0, failed = 0;
  for (let i = 1; i < values.length; i++) {
    if (!values[i][0]) continue;
    const rec = Db.toRecord(values[i]);
    const cls = Classifier.classify(rec.name, null, rules);
    if (cls.folder === rec.folder) continue;
    try {
      const m = storageFor_(rec).move(rec, cls.folder, rec.name);
      const keep = rec.tags.filter(t => t !== rec.category && !known[t]);
      rec.tags = keep.concat([cls.category], cls.tags).filter((t, j, a) => a.indexOf(t) === j);
      Object.assign(rec, { category: cls.category, folder: cls.folder, fileId: m.fileId, path: m.path, url: m.url, name: m.path.split('/').pop() });
      Db.update(i + 1, rec);
      moved++;
    } catch (e) { failed++; logActivity_('error', '重新分類「' + rec.name + '」失敗：' + e.message); }
  }
  logActivity_('info', '重新分類完成：搬移 ' + moved + ' 個檔案' + (failed ? '，' + failed + ' 個失敗' : ''));
  return { moved: moved, failed: failed };
}

// ---------- 儲存空間 ----------
function apiUseStorage(token, id) {
  requireAuth_(token);
  const s = STORAGE_PROVIDERS[id];
  if (!s) throw new Error('沒有這個儲存空間');
  if (!s.isReady()) throw new Error('請先連接 ' + s.label);
  Props.set('STORAGE', id);
  logActivity_('info', '之後收到的檔案會存到 ' + s.label);
  return true;
}
function apiDisconnectStorage(token, id) {
  requireAuth_(token);
  const s = STORAGE_PROVIDERS[id];
  if (!s || !s.disconnect) throw new Error('這個儲存空間不能中斷連接');
  s.disconnect();
  if (Props.get('STORAGE') === id) Props.set('STORAGE', 'gdrive');
  logActivity_('info', '已中斷 ' + s.label + ' 的連接');
  return true;
}
function apiOneDriveStart(token, clientId) {
  requireAuth_(token);
  clientId = String(clientId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) throw new Error('Client ID 格式不對，應該像 1a2b3c4d-…（36 個字元）');
  return STORAGE_PROVIDERS.onedrive.startLogin(clientId);
}
function apiOneDrivePoll(token, clientId, deviceCode) {
  requireAuth_(token);
  const r = STORAGE_PROVIDERS.onedrive.pollLogin(String(clientId).trim(), deviceCode);
  if (r.status === 'ok') logActivity_('info', '已連接 OneDrive（' + r.account + '）');
  return r;
}
function apiDropboxAuthUrl(token, appKey) {
  requireAuth_(token);
  if (!String(appKey || '').trim()) throw new Error('請先填 App key');
  return STORAGE_PROVIDERS.dropbox.authUrl(String(appKey).trim());
}
function apiDropboxConnect(token, appKey, appSecret, code) {
  requireAuth_(token);
  if (!appKey || !appSecret || !code) throw new Error('App key、App secret、授權碼都要填');
  const account = STORAGE_PROVIDERS.dropbox.connect(String(appKey).trim(), String(appSecret).trim(), String(code));
  logActivity_('info', '已連接 Dropbox（' + account + '）');
  return account;
}

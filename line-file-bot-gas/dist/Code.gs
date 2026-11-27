// LINE 檔案櫃（Google Apps Script 版）— 由 build.js 產生，請整份貼到 Apps Script 的 Code.gs

// ===== 00_config.js =====
/**
 * ============================================================
 *  LINE 檔案櫃 — Google Apps Script 版
 *  群組裡傳的檔案自動存到雲端空間（Google 雲端硬碟 / OneDrive / Dropbox），
 *  依檔名分類、標記上傳者，並提供網頁管理介面。
 *
 *  ⚠️ 安全規則：google.script.run 可以從網頁呼叫「任何」名稱不是底線結尾的全域函式。
 *     所以除了 doGet / doPost / api* 之外，所有全域函式都必須以 _ 結尾。
 * ============================================================
 */

const APP_NAME = 'LINE 檔案櫃';
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024; // Apps Script 單次下載上限約 50 MB

const DEFAULT_RULES = {
  categories: [
    { name: '文件', icon: 'doc', exts: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'pages'] },
    { name: '試算表', icon: 'sheet', exts: ['xls', 'xlsx', 'xlsm', 'csv', 'ods', 'numbers'] },
    { name: '簡報', icon: 'slide', exts: ['ppt', 'pptx', 'odp', 'key'] },
    { name: '圖片', icon: 'image', exts: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'svg', 'tif', 'tiff'] },
    { name: '影片', icon: 'video', exts: ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', '3gp'] },
    { name: '音訊', icon: 'audio', exts: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'amr'] },
    { name: '壓縮檔', icon: 'archive', exts: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2'] },
    { name: '設計檔', icon: 'design', exts: ['psd', 'ai', 'fig', 'sketch', 'xd', 'indd', 'dwg', 'dxf'] },
    { name: '程式碼', icon: 'code', exts: ['js', 'ts', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rb', 'php', 'html', 'css', 'json', 'xml', 'sql', 'sh'] },
  ],
  fallbackCategory: { name: '其他', icon: 'file' },
  keywordRules: [
    { keywords: ['報價', 'quotation', 'quote'], tag: '報價單', folder: '報價單' },
    { keywords: ['發票', 'invoice', '收據', 'receipt'], tag: '發票收據', folder: '發票收據' },
    { keywords: ['合約', '契約', 'contract', '協議'], tag: '合約', folder: '合約' },
    { keywords: ['會議', 'meeting', '紀錄', 'minutes'], tag: '會議紀錄' },
    { keywords: ['企劃', '提案', 'proposal'], tag: '企劃提案' },
    { keywords: ['報告', 'report'], tag: '報告' },
    { keywords: ['設計', 'design', 'logo', 'mockup'], tag: '設計' },
  ],
};

/** 設定值存在 Script Properties（只有你自己看得到） */
const Props = {
  store() { return PropertiesService.getScriptProperties(); },
  get(k, d) { const v = this.store().getProperty(k); return v == null ? d : v; },
  set(k, v) { if (v == null || v === '') this.store().deleteProperty(k); else this.store().setProperty(k, String(v)); },
  getJson(k, d) { try { const v = this.get(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  setJson(k, v) { this.set(k, v == null ? null : JSON.stringify(v)); },
};

function getRules_() { return Props.getJson('RULES', DEFAULT_RULES); }

function getWebhookKey_() {
  let k = Props.get('WEBHOOK_KEY');
  if (!k) { k = Utilities.getUuid().replace(/-/g, ''); Props.set('WEBHOOK_KEY', k); }
  return k;
}
function getWebAppUrl_() { return ScriptApp.getService().getUrl() || ''; }
/** LINE 不會送簽章以外的驗證資訊給 Apps Script，所以用網址裡的祕密 key 擋掉冒充的請求 */
function getWebhookUrl_() { return getWebAppUrl_() + '?key=' + getWebhookKey_(); }

// ===== 01_util.js =====
const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mpeg': 'mp3',
  'audio/aac': 'aac', 'application/pdf': 'pdf',
};

function extFromMime_(mime, fallback) {
  return MIME_EXT[String(mime || '').split(';')[0].trim().toLowerCase()] || fallback || 'bin';
}
function getExt_(name) {
  const m = String(name || '').match(/\.([^./\\]+)$/);
  return m ? m[1].toLowerCase() : '';
}
/** 移除不能當檔名的字元，避免路徑穿越 */
function sanitizeName_(name, max) {
  let s = String(name || '').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_').trim();
  if (!s) s = 'file';
  max = max || 150;
  if (s.length > max) {
    const ext = getExt_(s);
    const tail = ext ? '.' + ext : '';
    s = s.slice(0, max - tail.length) + tail;
  }
  return s;
}
function sanitizeFolder_(name) { return sanitizeName_(name, 60).replace(/\.+$/, '') || '未命名'; }

/** 同名時加上 (1)、(2)… */
function nextName_(name, i) {
  const ext = getExt_(name);
  const base = ext ? name.slice(0, -(ext.length + 1)) : name;
  return base + ' (' + i + ')' + (ext ? '.' + ext : '');
}
function splitPath_(p) { return String(p || '').split('/').filter(Boolean); }
function joinPath_() { return Array.prototype.slice.call(arguments).map(splitPath_).reduce((a, b) => a.concat(b), []).join('/'); }

function formStr_(obj) {
  return Object.keys(obj).filter(k => obj[k] != null).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])).join('&');
}

/** 統一的 HTTP 呼叫：回傳 { code, json, text, blob } */
function http_(url, opts) {
  const r = UrlFetchApp.fetch(url, Object.assign({ muteHttpExceptions: true }, opts || {}));
  const code = r.getResponseCode();
  let text = '';
  let json = null;
  const ct = String((r.getHeaders() || {})['Content-Type'] || (r.getHeaders() || {})['content-type'] || '');
  if (!opts || !opts.binary) {
    text = r.getContentText();
    if (/json/.test(ct) || /^\s*[{[]/.test(text)) { try { json = JSON.parse(text); } catch (e) {} }
  }
  return { code: code, json: json, text: text, contentType: ct, response: r };
}

// ===== 02_classifier.js =====
const Classifier = {
  categoryList(rules) {
    rules = rules || getRules_();
    return rules.categories.map(c => ({ name: c.name, icon: c.icon })).concat([{ name: rules.fallbackCategory.name, icon: 'file' }]);
  },
  iconFor(category, rules) {
    const c = this.categoryList(rules).filter(x => x.name === category)[0];
    return c ? c.icon : 'file';
  },
  /** @returns {{category, icon, folder, tags}} */
  classify(filename, lineType, rules) {
    rules = rules || getRules_();
    const ext = getExt_(filename);
    let cat = rules.categories.filter(c => c.exts.indexOf(ext) >= 0)[0];
    if (!cat) {
      const byType = { image: '圖片', video: '影片', audio: '音訊' }[lineType];
      cat = rules.categories.filter(c => c.name === byType)[0] || rules.fallbackCategory;
    }
    const lower = String(filename || '').toLowerCase();
    const tags = [];
    let sub = null;
    rules.keywordRules.forEach(r => {
      if (r.keywords.some(k => lower.indexOf(String(k).toLowerCase()) >= 0)) {
        if (r.tag && tags.indexOf(r.tag) < 0) tags.push(r.tag);
        if (!sub && r.folder) sub = r.folder;
      }
    });
    const folder = sub ? sanitizeFolder_(cat.name) + '/' + sanitizeFolder_(sub) : sanitizeFolder_(cat.name);
    return { category: cat.name, icon: cat.icon || 'file', folder: folder, tags: tags };
  },
};

const ICON_TYPES = ['doc', 'sheet', 'slide', 'image', 'video', 'audio', 'archive', 'design', 'code', 'file'];

function validateRules_(r) {
  const clean = (s, max) => String(s == null ? '' : s).trim().slice(0, max || 40);
  const list = (v, max) => (Array.isArray(v) ? v : String(v == null ? '' : v).split(/[,，、\s]+/)).map(x => clean(x, max)).filter(Boolean);
  const bad = /[\\/:*?"<>|]/g;
  const seen = {};
  const categories = (r.categories || []).map(c => ({
    name: clean(c.name, 30).replace(bad, ''),
    icon: ICON_TYPES.indexOf(c.icon) >= 0 ? c.icon : 'file',
    exts: list(c.exts, 12).map(e => e.replace(/^\./, '').toLowerCase()).filter((e, i, a) => a.indexOf(e) === i),
  })).filter(c => c.name && !seen[c.name] && (seen[c.name] = true));
  if (!categories.length) throw new Error('至少要有一個分類');
  const fb = clean(r.fallbackCategory && r.fallbackCategory.name, 30).replace(bad, '') || '其他';
  if (seen[fb]) throw new Error('「' + fb + '」不能同時是一般分類和未分類的預設資料夾');
  const keywordRules = (r.keywordRules || []).map(k => {
    const o = { keywords: list(k.keywords), tag: clean(k.tag, 30).replace(/,/g, '') };
    const f = clean(k.folder, 30).replace(bad, '');
    if (f) o.folder = f;
    return o;
  }).filter(k => k.keywords.length && (k.tag || k.folder));
  return { categories: categories, fallbackCategory: { name: fb, icon: 'file' }, keywordRules: keywordRules };
}

// ===== 03_line.js =====
const LINE_API = 'https://api.line.me';
const LINE_DATA_API = 'https://api-data.line.me';

const Line = {
  token() { return Props.get('LINE_TOKEN', ''); },
  call(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ Authorization: 'Bearer ' + this.token() }, opts.headers || {});
    return http_(url, opts);
  },
  json(url) {
    const r = this.call(url);
    if (r.code === 401) throw new Error('LINE 拒絕存取（401）：Channel access token 錯誤或已過期');
    if (r.code >= 300) throw new Error('LINE API 錯誤 ' + r.code);
    return r.json;
  },
  /** 下載訊息內容，回傳 Blob */
  download(messageId) {
    const url = LINE_DATA_API + '/v2/bot/message/' + encodeURIComponent(messageId) + '/content';
    for (let i = 0; i < 8; i++) {
      let r;
      try {
        r = this.call(url, { binary: true });
      } catch (e) {
        if (/size|large|大小|limit/i.test(e.message)) throw new Error('檔案超過 50 MB，Google Apps Script 無法下載');
        throw e;
      }
      if (r.code === 202) { Utilities.sleep(2000 * (i + 1)); continue; } // 影片 / 語音轉檔中
      if (r.code !== 200) throw new Error('下載內容失敗（' + r.code + '）');
      return r.response.getBlob();
    }
    throw new Error('LINE 還在處理這個檔案，稍後仍無法下載');
  },
  senderProfile(src) {
    const uid = encodeURIComponent(src.userId);
    if (src.type === 'group') return this.json(LINE_API + '/v2/bot/group/' + encodeURIComponent(src.groupId) + '/member/' + uid);
    if (src.type === 'room') return this.json(LINE_API + '/v2/bot/room/' + encodeURIComponent(src.roomId) + '/member/' + uid);
    return this.json(LINE_API + '/v2/bot/profile/' + uid);
  },
  groupName(groupId) { return this.json(LINE_API + '/v2/bot/group/' + encodeURIComponent(groupId) + '/summary').groupName; },
  botInfo() { return this.json(LINE_API + '/v2/bot/info'); },
  webhookEndpoint() { return this.json(LINE_API + '/v2/bot/channel/webhook/endpoint'); },
  reply(replyToken, text) {
    this.call(LINE_API + '/v2/bot/message/reply', {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: text }] }),
    });
  },
};

// ===== 10_storage.js =====
/**
 * ============================================================
 *  儲存空間介面
 *
 *  想接新的雲端空間（例如 Box、pCloud…），照下面的格式寫一個物件，
 *  呼叫 registerStorage_() 註冊即可，其他程式完全不用改。
 *
 *  {
 *    id:      'mycloud',              // 英文代號，會存進試算表
 *    label:   '我的雲端',             // 顯示名稱
 *    isReady()                        → 是否已連接（true / false）
 *    account()                        → 顯示用的帳號名稱（可選）
 *    save(blob, folder, name)         → { fileId, path, url }
 *                                        folder 例如 "文件/報價單"（相對於根資料夾）
 *                                        同名時請自動改名，不要覆蓋
 *    move(rec, folder, name)          → { fileId, path, url }  搬移和 / 或改名
 *    remove(rec)                      → 刪除（建議移到垃圾桶）
 *    thumbnail(rec)                   → 縮圖網址或 data URL；沒有就回傳 null（可選）
 *    disconnect()                     → 清除金鑰（可選）
 *  }
 *
 *  rec 是試算表裡的一筆紀錄：{ fileId, path, folder, name, storage, … }
 * ============================================================
 */
const STORAGE_PROVIDERS = {};
const STORAGE_ORDER = [];

function registerStorage_(p) {
  if (!STORAGE_PROVIDERS[p.id]) STORAGE_ORDER.push(p.id);
  STORAGE_PROVIDERS[p.id] = p;
}
function activeStorage_() {
  return STORAGE_PROVIDERS[Props.get('STORAGE', 'gdrive')] || STORAGE_PROVIDERS.gdrive;
}
function storageFor_(rec) {
  const s = STORAGE_PROVIDERS[rec.storage];
  if (!s) throw new Error('找不到儲存空間「' + rec.storage + '」');
  if (!s.isReady()) throw new Error(s.label + ' 尚未連接，無法操作這個檔案');
  return s;
}
function rootFolderName_() { return Props.get('ROOT_FOLDER', APP_NAME); }

/** OAuth：用 refresh token 換 access token，快取 50 分鐘 */
function oauthAccessToken_(cacheKey, refresh) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const tok = refresh();
  cache.put(cacheKey, tok.access_token, Math.min(3000, (tok.expires_in || 3600) - 300));
  return tok.access_token;
}

// ===== 11_storage_gdrive.js =====
/** Google 雲端硬碟：直接用你自己的 Google 帳號，不需要任何設定 */
registerStorage_({
  id: 'gdrive',
  label: 'Google 雲端硬碟',
  isReady() { return true; },
  account() { try { return Session.getEffectiveUser().getEmail(); } catch (e) { return ''; } },

  root() {
    const id = Props.get('GDRIVE_ROOT_ID');
    if (id) {
      try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {}
    }
    const f = DriveApp.createFolder(rootFolderName_());
    Props.set('GDRIVE_ROOT_ID', f.getId());
    return f;
  },
  folder(path) {
    let f = this.root();
    splitPath_(path).forEach(seg => {
      const it = f.getFoldersByName(seg);
      f = it.hasNext() ? it.next() : f.createFolder(seg);
    });
    return f;
  },
  unique(folder, name) {
    let n = name;
    for (let i = 1; folder.getFilesByName(n).hasNext(); i++) n = nextName_(name, i);
    return n;
  },
  save(blob, folder, name) {
    const f = this.folder(folder);
    const n = this.unique(f, name);
    blob.setName(n);
    const file = f.createFile(blob);
    return { fileId: file.getId(), path: joinPath_(folder, n), url: file.getUrl() };
  },
  clash(folder, name, selfId) {
    const it = folder.getFilesByName(name);
    while (it.hasNext()) if (it.next().getId() !== selfId) return true;
    return false;
  },
  move(rec, folder, name) {
    const file = DriveApp.getFileById(rec.fileId);
    const f = this.folder(folder);
    if (folder !== rec.folder) file.moveTo(f);
    let n = name;
    for (let i = 1; this.clash(f, n, file.getId()); i++) n = nextName_(name, i);
    if (n !== file.getName()) file.setName(n);
    return { fileId: file.getId(), path: joinPath_(folder, n), url: file.getUrl() };
  },
  remove(rec) { DriveApp.getFileById(rec.fileId).setTrashed(true); },
  thumbnail(rec) {
    const blob = DriveApp.getFileById(rec.fileId).getThumbnail();
    return blob ? 'data:' + (blob.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(blob.getBytes()) : null;
  },
  renameRoot(name) { this.root().setName(name); },
});

// ===== 12_storage_onedrive.js =====
/**
 * OneDrive（個人版或公司 / 學校帳號皆可）— 透過 Microsoft Graph API
 * 需要先在 Azure 註冊一個應用程式取得「用戶端識別碼 (Client ID)」，步驟見說明文件。
 * 連接方式使用「裝置代碼登入」：網頁上顯示一組代碼，到 microsoft.com/devicelogin 輸入即可。
 */
const MS_LOGIN = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const MS_GRAPH = 'https://graph.microsoft.com/v1.0';
const MS_SCOPE = 'Files.ReadWrite User.Read offline_access';
const ONEDRIVE_CHUNK = 320 * 1024 * 32; // 10 MB，必須是 320 KB 的倍數

registerStorage_({
  id: 'onedrive',
  label: 'OneDrive',
  isReady() { return Boolean(Props.get('OD_REFRESH') && Props.get('OD_CLIENT_ID')); },
  account() { return Props.get('OD_ACCOUNT', ''); },

  // ----- 連接 -----
  startLogin(clientId) {
    const r = http_(MS_LOGIN + '/devicecode', { method: 'post', contentType: 'application/x-www-form-urlencoded', payload: formStr_({ client_id: clientId, scope: MS_SCOPE }) });
    if (r.code !== 200) throw new Error('無法開始登入：' + ((r.json && r.json.error_description) || r.code) + '。請確認 Client ID 正確，且已開啟「允許公用用戶端流程」');
    return { userCode: r.json.user_code, verificationUri: r.json.verification_uri, deviceCode: r.json.device_code, interval: r.json.interval || 5, expiresIn: r.json.expires_in };
  },
  pollLogin(clientId, deviceCode) {
    const r = http_(MS_LOGIN + '/token', { method: 'post', contentType: 'application/x-www-form-urlencoded',
      payload: formStr_({ client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    if (r.code === 200) {
      Props.set('OD_CLIENT_ID', clientId);
      Props.set('OD_REFRESH', r.json.refresh_token);
      CacheService.getScriptCache().put('od_access', r.json.access_token, 3000);
      const me = this.graph('get', '/me').json || {};
      Props.set('OD_ACCOUNT', me.userPrincipalName || me.mail || me.displayName || 'OneDrive');
      return { status: 'ok', account: this.account() };
    }
    const err = r.json && r.json.error;
    if (err === 'authorization_pending' || err === 'slow_down') return { status: 'pending' };
    return { status: 'error', error: (r.json && r.json.error_description || '登入失敗').split('\r\n')[0] };
  },
  disconnect() { ['OD_REFRESH', 'OD_ACCOUNT', 'OD_ROOT_ID'].forEach(k => Props.set(k, null)); CacheService.getScriptCache().remove('od_access'); },

  // ----- API -----
  accessToken() {
    return oauthAccessToken_('od_access', () => {
      const r = http_(MS_LOGIN + '/token', { method: 'post', contentType: 'application/x-www-form-urlencoded',
        payload: formStr_({ client_id: Props.get('OD_CLIENT_ID'), grant_type: 'refresh_token', refresh_token: Props.get('OD_REFRESH'), scope: MS_SCOPE }) });
      if (r.code !== 200) throw new Error('OneDrive 授權已失效，請到「設定」重新連接（' + ((r.json && r.json.error) || r.code) + '）');
      if (r.json.refresh_token) Props.set('OD_REFRESH', r.json.refresh_token);
      return r.json;
    });
  },
  graph(method, path, body, extra) {
    const opts = Object.assign({ method: method, headers: { Authorization: 'Bearer ' + this.accessToken() } }, extra || {});
    if (body !== undefined && !opts.payload) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
    return http_(path.indexOf('http') === 0 ? path : MS_GRAPH + path, opts);
  },
  check(r, what) {
    if (r.code >= 300) throw new Error('OneDrive ' + what + '失敗：' + ((r.json && r.json.error && r.json.error.message) || r.code));
    return r.json;
  },
  enc(path) { return splitPath_(path).map(encodeURIComponent).join('/'); },
  fullPath(folder) { return joinPath_(rootFolderName_(), folder); },
  ensureFolder(path) {
    // 逐層確認資料夾存在，回傳最後一層的 id
    let parentId = null;
    let cur = '';
    splitPath_(path).forEach(seg => {
      cur = joinPath_(cur, seg);
      let r = this.graph('get', '/me/drive/root:/' + this.enc(cur));
      if (r.code === 404) {
        const parent = parentId ? '/me/drive/items/' + parentId + '/children' : '/me/drive/root/children';
        r = this.graph('post', parent, { name: seg, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' });
        if (r.code === 409) r = this.graph('get', '/me/drive/root:/' + this.enc(cur));
      }
      parentId = this.check(r, '建立資料夾').id;
    });
    return parentId;
  },
  result(item, folder) {
    return { fileId: item.id, path: joinPath_(folder, item.name), url: item.webUrl };
  },
  save(blob, folder, name) {
    const full = joinPath_(this.fullPath(folder), name);
    const bytes = blob.getBytes();
    let item;
    if (bytes.length <= 4 * 1024 * 1024) {
      this.ensureFolder(this.fullPath(folder));
      item = this.check(this.graph('put', '/me/drive/root:/' + this.enc(full) + ':/content?@microsoft.graph.conflictBehavior=rename', undefined,
        { contentType: blob.getContentType() || 'application/octet-stream', payload: bytes }), '上傳');
    } else {
      // 大檔：分段上傳
      this.ensureFolder(this.fullPath(folder));
      const s = this.check(this.graph('post', '/me/drive/root:/' + this.enc(full) + ':/createUploadSession',
        { item: { '@microsoft.graph.conflictBehavior': 'rename' } }), '建立上傳工作');
      for (let start = 0; start < bytes.length; start += ONEDRIVE_CHUNK) {
        const end = Math.min(start + ONEDRIVE_CHUNK, bytes.length);
        const r = http_(s.uploadUrl, { method: 'put', contentType: 'application/octet-stream', payload: bytes.slice(start, end),
          headers: { 'Content-Range': 'bytes ' + start + '-' + (end - 1) + '/' + bytes.length } });
        if (r.code >= 300) throw new Error('OneDrive 分段上傳失敗：' + r.code);
        if (end === bytes.length) item = r.json;
      }
    }
    return this.result(item, folder);
  },
  move(rec, folder, name) {
    const patch = {};
    if (folder !== rec.folder) patch.parentReference = { id: this.ensureFolder(this.fullPath(folder)) };
    if (name !== rec.name) patch.name = name;
    let r = this.graph('patch', '/me/drive/items/' + encodeURIComponent(rec.fileId), patch);
    for (let i = 1; r.code === 409 && i < 50; i++) { patch.name = nextName_(name, i); r = this.graph('patch', '/me/drive/items/' + encodeURIComponent(rec.fileId), patch); }
    return this.result(this.check(r, '搬移'), folder);
  },
  remove(rec) {
    const r = this.graph('delete', '/me/drive/items/' + encodeURIComponent(rec.fileId));
    if (r.code >= 300 && r.code !== 404) this.check(r, '刪除');
  },
  thumbnail(rec) {
    const r = this.graph('get', '/me/drive/items/' + encodeURIComponent(rec.fileId) + '/thumbnails/0/medium');
    return r.code === 200 && r.json ? r.json.url : null;
  },
});

// ===== 13_storage_dropbox.js =====
/**
 * Dropbox — 需要在 Dropbox App Console 建立一個 App，取得 App key / App secret，步驟見說明文件。
 */
const DBX_API = 'https://api.dropboxapi.com';
const DBX_CONTENT = 'https://content.dropboxapi.com';

/** Dropbox-API-Arg 標頭只能放 ASCII，中文要轉成 \uXXXX */
function dropboxArg_(obj) {
  return JSON.stringify(obj).replace(/[\u007f-￿]/g, c => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4));
}

registerStorage_({
  id: 'dropbox',
  label: 'Dropbox',
  isReady() { return Boolean(Props.get('DBX_REFRESH')); },
  account() { return Props.get('DBX_ACCOUNT', ''); },

  // ----- 連接 -----
  authUrl(appKey) {
    return 'https://www.dropbox.com/oauth2/authorize?' + formStr_({ client_id: appKey, response_type: 'code', token_access_type: 'offline' });
  },
  connect(appKey, appSecret, code) {
    const r = http_(DBX_API + '/oauth2/token', { method: 'post', contentType: 'application/x-www-form-urlencoded',
      payload: formStr_({ code: code.trim(), grant_type: 'authorization_code', client_id: appKey, client_secret: appSecret }) });
    if (r.code !== 200) throw new Error('Dropbox 連接失敗：' + ((r.json && (r.json.error_description || r.json.error)) || r.code) + '（授權碼只能用一次，失敗請重新取得）');
    Props.set('DBX_KEY', appKey); Props.set('DBX_SECRET', appSecret); Props.set('DBX_REFRESH', r.json.refresh_token);
    CacheService.getScriptCache().put('dbx_access', r.json.access_token, 3000);
    const me = this.rpc('/2/users/get_current_account', null);
    Props.set('DBX_ACCOUNT', (me && (me.email || (me.name && me.name.display_name))) || 'Dropbox');
    return this.account();
  },
  disconnect() { ['DBX_REFRESH', 'DBX_ACCOUNT'].forEach(k => Props.set(k, null)); CacheService.getScriptCache().remove('dbx_access'); },

  // ----- API -----
  accessToken() {
    return oauthAccessToken_('dbx_access', () => {
      const r = http_(DBX_API + '/oauth2/token', { method: 'post', contentType: 'application/x-www-form-urlencoded',
        payload: formStr_({ grant_type: 'refresh_token', refresh_token: Props.get('DBX_REFRESH'), client_id: Props.get('DBX_KEY'), client_secret: Props.get('DBX_SECRET') }) });
      if (r.code !== 200) throw new Error('Dropbox 授權已失效，請到「設定」重新連接');
      return r.json;
    });
  },
  rpc(path, body) {
    const opts = { method: 'post', headers: { Authorization: 'Bearer ' + this.accessToken() } };
    if (body !== null) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
    const r = http_(DBX_API + path, opts);
    if (r.code >= 300) throw new Error('Dropbox 錯誤：' + ((r.json && r.json.error_summary) || r.text || r.code));
    return r.json;
  },
  full(folder, name) { return '/' + joinPath_(rootFolderName_(), folder, name); },
  result(meta, folder) {
    const parent = meta.path_display.split('/').slice(0, -1).join('/');
    return { fileId: meta.id, path: joinPath_(folder, meta.name), url: 'https://www.dropbox.com/home' + encodeURI(parent) + '?preview=' + encodeURIComponent(meta.name) };
  },
  save(blob, folder, name) {
    const r = http_(DBX_CONTENT + '/2/files/upload', {
      method: 'post', contentType: 'application/octet-stream', payload: blob.getBytes(),
      headers: { Authorization: 'Bearer ' + this.accessToken(), 'Dropbox-API-Arg': dropboxArg_({ path: this.full(folder, name), mode: 'add', autorename: true }) },
    });
    if (r.code >= 300) throw new Error('Dropbox 上傳失敗：' + ((r.json && r.json.error_summary) || r.code));
    return this.result(r.json, folder);
  },
  move(rec, folder, name) {
    const r = this.rpc('/2/files/move_v2', { from_path: rec.fileId, to_path: this.full(folder, name), autorename: true });
    return this.result(r.metadata, folder);
  },
  remove(rec) { this.rpc('/2/files/delete_v2', { path: rec.fileId }); },
  thumbnail() { return null; },
});

/** iCloud：Apple 沒有開放 iCloud 雲碟的 API，第三方程式無法寫入，因此只放說明、不能選。 */

// ===== 20_db.js =====
/**
 * 資料庫 = 一份 Google 試算表（放在雲端硬碟的「LINE 檔案櫃」資料夾）
 *   「檔案清單」分頁：每個檔案一列，也可以直接在試算表裡篩選、查看
 *   「活動紀錄」分頁：Bot 收到了什麼、有沒有錯誤
 */
const FILE_COLUMNS = [
  ['id', 'ID'], ['messageId', 'LINE 訊息 ID'], ['name', '檔名'], ['category', '分類'], ['folder', '資料夾'],
  ['ext', '副檔名'], ['size', '大小 (bytes)'], ['uploader', '上傳者'], ['uploaderId', '上傳者 ID'],
  ['sourceType', '來源類型'], ['source', '群組 / 聊天室'], ['tags', '標籤'], ['uploadedAt', '上傳時間'],
  ['storage', '儲存空間'], ['fileId', '檔案 ID'], ['path', '檔案路徑'], ['url', '檔案連結'], ['mime', '檔案格式'],
];
const FILES_SHEET = '檔案清單';
const LOG_SHEET = '活動紀錄';

/** 防止檔名被試算表當成公式（例如 =HYPERLINK…），以及長數字 ID 被轉成數字失去精度 */
function cell_(v) {
  if (typeof v === 'string' && (/^[=+\-@']/.test(v) || /^\d{6,}$/.test(v))) return "'" + v;
  return v;
}

const Db = {
  ss() {
    if (this._ss) return this._ss;
    const id = Props.get('SHEET_ID');
    if (id) { try { return (this._ss = SpreadsheetApp.openById(id)); } catch (e) {} }
    const ss = SpreadsheetApp.create(APP_NAME + ' 資料庫');
    const files = ss.getSheets()[0];
    files.setName(FILES_SHEET);
    files.getRange(1, 1, 1, FILE_COLUMNS.length).setValues([FILE_COLUMNS.map(c => c[1])]).setFontWeight('bold');
    files.setFrozenRows(1);
    const log = ss.insertSheet(LOG_SHEET);
    log.getRange(1, 1, 1, 3).setValues([['時間', '類型', '內容']]).setFontWeight('bold');
    log.setFrozenRows(1);
    Props.set('SHEET_ID', ss.getId());
    try { DriveApp.getFileById(ss.getId()).moveTo(STORAGE_PROVIDERS.gdrive.root()); } catch (e) {}
    return (this._ss = ss);
  },
  sheet() { return this.ss().getSheetByName(FILES_SHEET); },

  toRecord(row) {
    const r = {};
    FILE_COLUMNS.forEach((c, i) => { r[c[0]] = row[i]; });
    r.tags = String(r.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    r.size = Number(r.size) || 0;
    r.uploadedAt = r.uploadedAt instanceof Date ? r.uploadedAt.toISOString() : String(r.uploadedAt || '');
    ['id', 'messageId', 'name', 'category', 'folder', 'ext', 'uploader', 'uploaderId', 'sourceType', 'source', 'storage', 'fileId', 'path', 'url', 'mime']
      .forEach(k => { r[k] = r[k] == null ? '' : String(r[k]); });
    return r;
  },
  toRow(rec) {
    return FILE_COLUMNS.map(c => {
      const v = rec[c[0]];
      if (c[0] === 'tags') return cell_((v || []).map(t => String(t).replace(/,/g, ' ')).join(', '));
      if (c[0] === 'uploadedAt') return v ? new Date(v) : new Date();
      return cell_(v == null ? '' : v);
    });
  },
  all() {
    const values = this.sheet().getDataRange().getValues();
    return values.slice(1).filter(r => r[0]).map(r => this.toRecord(r));
  },
  findRow(id) {
    const values = this.sheet().getDataRange().getValues();
    for (let i = 1; i < values.length; i++) if (String(values[i][0]) === String(id)) return { row: i + 1, rec: this.toRecord(values[i]) };
    return null;
  },
  hasMessage(messageId) {
    const sh = this.sheet();
    const n = sh.getLastRow();
    if (n < 2) return false;
    return sh.getRange(2, 2, n - 1, 1).getValues().some(r => String(r[0]) === String(messageId));
  },
  add(rec) {
    rec.id = rec.id || Utilities.getUuid();
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try { this.sheet().appendRow(this.toRow(rec)); } finally { lock.releaseLock(); }
    return rec;
  },
  update(row, rec) { this.sheet().getRange(row, 1, 1, FILE_COLUMNS.length).setValues([this.toRow(rec)]); return rec; },
  remove(row) { this.sheet().deleteRow(row); },
};

/** 寫活動紀錄（最新的在最上面，最多保留 500 筆） */
function logActivity_(level, msg) {
  try { console.log('[' + level + '] ' + msg); } catch (e) {}
  try {
    const sh = Db.ss().getSheetByName(LOG_SHEET);
    sh.insertRowAfter(1);
    sh.getRange(2, 1, 1, 3).setValues([[new Date(), level, cell_(String(msg).slice(0, 500))]]);
    if (sh.getLastRow() > 520) sh.deleteRows(502, sh.getLastRow() - 501);
  } catch (e) {}
}

// ===== 30_auth.js =====
/**
 * 管理介面的登入。網頁版 Apps Script 必須設成「任何人都能存取」LINE 才送得進來，
 * 所以管理功能另外用密碼保護：每個 api* 函式第一個參數都是登入 token。
 */
function hashPassword_(pw, salt) {
  let h = salt + ':' + pw;
  for (let i = 0; i < 1000; i++) h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt));
  return h;
}
function passwordConfigured_() { return Boolean(Props.get('PW_HASH')); }
function checkPassword_(pw) {
  const salt = Props.get('PW_SALT');
  return Boolean(salt) && hashPassword_(String(pw || ''), salt) === Props.get('PW_HASH');
}
function setPassword_(pw) {
  const salt = Utilities.getUuid();
  Props.set('PW_SALT', salt);
  Props.set('PW_HASH', hashPassword_(String(pw), salt));
  Props.setJson('SESSIONS', {}); // 改密碼後所有裝置都要重新登入
}
function newSession_() {
  const now = Date.now();
  const s = Props.getJson('SESSIONS', {});
  Object.keys(s).forEach(k => { if (s[k] < now) delete s[k]; });
  const keys = Object.keys(s).sort((a, b) => s[a] - s[b]);
  while (keys.length >= 20) delete s[keys.shift()];
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  s[token] = now + 30 * 24 * 3600 * 1000;
  Props.setJson('SESSIONS', s);
  return token;
}
function isLoggedIn_(token) {
  if (!token || !passwordConfigured_()) return false;
  const exp = Props.getJson('SESSIONS', {})[token];
  return Boolean(exp && exp > Date.now());
}
function requireAuth_(token) {
  if (!isLoggedIn_(token)) throw new Error('AUTH: 請先登入');
}
/** 登入失敗太多次就暫停 15 分鐘 */
function loginThrottle_(failed) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('login_fail') || 0);
  if (failed === undefined) return n >= 20;
  if (failed) { cache.put('login_fail', String(n + 1), 900); Utilities.sleep(800); } else cache.remove('login_fail');
}

// ===== 40_webhook.js =====
/** LINE 會把群組裡的每則訊息 POST 到這裡 */
function doPost(e) {
  const ok = ContentService.createTextOutput('ok');
  const key = e && e.parameter && e.parameter.key;
  if (!key || key !== Props.get('WEBHOOK_KEY')) {
    logActivity_('warn', '收到網址 key 不正確的請求，已忽略（LINE 後台的 Webhook 網址要整串複製，包含 ?key=…）');
    return ok;
  }
  let body;
  try { body = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (err) { return ok; }
  Props.set('LAST_WEBHOOK_AT', new Date().toISOString());
  const events = body.events || [];
  if (!events.length) logActivity_('info', '收到 LINE 的 Webhook 驗證請求（Verify）✔');
  events.forEach(ev => {
    try { handleEvent_(ev); } catch (err) { logActivity_('error', '處理失敗：' + err.message); }
  });
  return ok;
}

function rememberGroup_(gid) {
  const groups = Props.getJson('GROUPS', {});
  if (!groups[gid]) {
    let name = '群組';
    try { name = Line.groupName(gid); } catch (e) {}
    groups[gid] = { name: name, since: new Date().toISOString() };
    Props.setJson('GROUPS', groups);
  }
  return groups[gid];
}

const LINE_FILE_TYPES = ['file', 'image', 'video', 'audio'];

function handleEvent_(ev) {
  const src = ev.source || {};
  const gid = src.groupId;
  if (ev.type === 'join' && gid) { logActivity_('info', 'Bot 已加入群組「' + rememberGroup_(gid).name + '」'); return null; }
  if (ev.type === 'leave' && gid) {
    const groups = Props.getJson('GROUPS', {});
    logActivity_('info', 'Bot 已離開群組「' + ((groups[gid] && groups[gid].name) || gid) + '」');
    delete groups[gid]; Props.setJson('GROUPS', groups);
    return null;
  }
  if (ev.type !== 'message' || !ev.message || LINE_FILE_TYPES.indexOf(ev.message.type) < 0) return null;
  const msg = ev.message;

  // LINE 重送時避免重複
  const cache = CacheService.getScriptCache();
  if (cache.get('msg_' + msg.id) || Db.hasMessage(msg.id)) return null;
  cache.put('msg_' + msg.id, '1', 21600);

  if (msg.fileSize && msg.fileSize > MAX_DOWNLOAD_BYTES) {
    logActivity_('warn', '「' + msg.fileName + '」超過 50 MB，Google 版無法下載，已略過');
    if (Props.get('REPLY_ON_SAVE') === 'true' && ev.replyToken) Line.reply(ev.replyToken, '⚠️「' + msg.fileName + '」超過 50 MB，無法自動備份');
    return null;
  }

  const sourceId = src.groupId || src.roomId || src.userId || '';
  let sourceName = src.type === 'room' ? '多人聊天室' : src.type === 'user' ? '一對一聊天' : '群組';
  if (gid) sourceName = rememberGroup_(gid).name;

  // 上傳者名稱（快取 6 小時）
  let uploader = '未知成員';
  if (src.userId) {
    const ck = 'name_' + sourceId + '_' + src.userId;
    uploader = cache.get(ck);
    if (!uploader) {
      try { uploader = Line.senderProfile(src).displayName; cache.put(ck, uploader, 21600); }
      catch (e) { uploader = '成員' + src.userId.slice(-4); }
    }
  }

  const blob = Line.download(msg.id);
  const mime = blob.getContentType() || '';
  let original = msg.type === 'file' && msg.fileName ? msg.fileName : null;
  if (!original) {
    const prefix = { image: '圖片', video: '影片', audio: '語音' }[msg.type];
    const stamp = Utilities.formatDate(new Date(ev.timestamp || Date.now()), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    original = prefix + '_' + stamp + '.' + extFromMime_(mime, { image: 'jpg', video: 'mp4', audio: 'm4a' }[msg.type]);
  }
  const name = sanitizeName_(original);
  const cls = Classifier.classify(name, msg.type);
  const storage = activeStorage_();
  if (!storage.isReady()) throw new Error(storage.label + ' 尚未連接，無法儲存「' + name + '」');
  const saved = storage.save(blob, cls.folder, name);

  const tags = ['@' + uploader, cls.category].concat(cls.tags);
  if (gid) tags.push('群:' + sourceName);
  const rec = Db.add({
    messageId: msg.id, name: saved.path.split('/').pop(), category: cls.category, folder: cls.folder,
    ext: getExt_(name), size: blob.getBytes().length, uploader: uploader, uploaderId: src.userId || '',
    sourceType: src.type || '', source: sourceName, tags: tags.filter((t, i) => tags.indexOf(t) === i),
    uploadedAt: new Date(ev.timestamp || Date.now()).toISOString(),
    storage: storage.id, fileId: saved.fileId, path: saved.path, url: saved.url, mime: mime,
  });
  Props.set('LAST_FILE_AT', new Date().toISOString());
  logActivity_('info', '已收下「' + rec.name + '」→ ' + storage.label + '/' + cls.folder + '（' + uploader + '）');
  if (Props.get('REPLY_ON_SAVE') === 'true' && ev.replyToken) {
    try { Line.reply(ev.replyToken, '📁 已收到「' + rec.name + '」，存到 ' + cls.folder); } catch (e) {}
  }
  return rec;
}

// ===== 50_api.js =====
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

// ===== 60_web.js =====
/** 打開網址時顯示管理介面 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

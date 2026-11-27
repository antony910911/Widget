// LINE 檔案櫃（Google Apps Script 版）
// 安裝：在 https://script.new 開新專案，把這整份貼進去取代原本內容 → 儲存 → 部署成網頁應用程式（執行身分：我／存取權：所有人）

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
  // 單檔安裝版把網頁內容放在 INDEX_HTML（由 build.js 產生）；分開的 Index.html 檔也支援
  const out = typeof INDEX_HTML === 'string' ? HtmlService.createHtmlOutput(INDEX_HTML) : HtmlService.createHtmlOutputFromFile('Index');
  return out
    .setTitle(APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ===== 網頁介面（由 ui/ 產生，請勿手動修改）=====
const INDEX_HTML = "<!doctype html>\n<html lang=\"zh-Hant\">\n<head>\n<base target=\"_top\">\n<meta charset=\"utf-8\">\n<style>\n:root {\n  --bg: #f5f6f8; --panel: #ffffff; --panel-2: #f0f2f5; --line: #e3e6eb;\n  --text: #1c2026; --muted: #6b7380; --accent: #06c755; --accent-ink: #04893b; --accent-soft: #e3f8ea;\n  --danger: #d93a3a; --shadow: 0 1px 2px rgba(20,24,30,.06), 0 4px 16px rgba(20,24,30,.06);\n  --radius: 12px;\n}\n@media (prefers-color-scheme: dark) {\n  :root { --bg: #111418; --panel: #181c21; --panel-2: #20252c; --line: #2a3038; --text: #e7eaee; --muted: #949ca8;\n    --accent: #1fd16b; --accent-ink: #4ee08b; --accent-soft: #15301f; --shadow: 0 1px 2px rgba(0,0,0,.3), 0 6px 20px rgba(0,0,0,.25); }\n}\n* { box-sizing: border-box; }\nhtml, body { margin: 0; height: 100%; }\nbody { background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system, BlinkMacSystemFont, \"Segoe UI\", \"PingFang TC\", \"Noto Sans TC\", \"Microsoft JhengHei\", sans-serif; }\nsvg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex: none; }\nbutton, select, input { font: inherit; color: inherit; }\n[hidden] { display: none !important; }\n\n/* top bar */\n.topbar { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 16px; padding: 10px 20px; background: var(--panel); border-bottom: 1px solid var(--line); }\n.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 16px; white-space: nowrap; }\n.brand-mark { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; background: var(--accent); color: #fff; }\n.brand-mark svg { fill: #fff; stroke: none; width: 18px; height: 18px; }\n.search { flex: 1; max-width: 560px; display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 38px; border-radius: 10px; background: var(--panel-2); color: var(--muted); border: 1px solid transparent; }\n.search:focus-within { border-color: var(--accent); background: var(--panel); }\n.search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); }\n.top-actions { display: flex; align-items: center; gap: 10px; margin-left: auto; }\nselect { height: 38px; padding: 0 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); }\n.seg { display: flex; padding: 3px; gap: 2px; background: var(--panel-2); border-radius: 10px; }\n.seg button { display: grid; place-items: center; width: 34px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); cursor: pointer; }\n.seg button.on { background: var(--panel); color: var(--text); box-shadow: var(--shadow); }\n.btn { display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); cursor: pointer; white-space: nowrap; text-decoration: none; color: var(--text); }\n.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }\n.btn.danger { color: var(--danger); }\n.btn:hover { filter: brightness(.97); }\n.icon-btn { display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 9px; background: transparent; cursor: pointer; color: var(--muted); }\n.icon-btn:hover { background: var(--panel-2); color: var(--text); }\n.only-mobile { display: none; }\n\n/* layout */\n.layout { display: grid; grid-template-columns: 264px 1fr; min-height: calc(100vh - 59px); }\n.sidebar { position: sticky; top: 59px; height: calc(100vh - 59px); overflow-y: auto; padding: 16px; border-right: 1px solid var(--line); background: var(--panel); }\n.stat { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px; }\n.stat > div { padding: 10px 12px; border-radius: 10px; background: var(--panel-2); }\n.stat b { display: block; font-size: 18px; font-variant-numeric: tabular-nums; }\n.stat span { color: var(--muted); font-size: 12px; }\n.sidebar h3 { margin: 18px 4px 6px; font-size: 12px; font-weight: 600; letter-spacing: .04em; color: var(--muted); }\n.facet { list-style: none; margin: 0; padding: 0; }\n.facet li button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 8px; border: 0; border-radius: 8px; background: transparent; cursor: pointer; text-align: left; }\n.facet li button:hover { background: var(--panel-2); }\n.facet li button.on { background: var(--accent-soft); color: var(--accent-ink); font-weight: 600; }\n.facet .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.facet .count { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }\n.facet .zero { opacity: .5; }\n.mini-icon { width: 22px; height: 26px; }\n.avatar { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; color: #fff; font-size: 12px; font-weight: 700; flex: none; }\n.tag-cloud { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 4px; }\n.chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); font-size: 12px; cursor: pointer; white-space: nowrap; }\n.chip:hover { border-color: var(--accent); }\n.chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }\n.chip.person { background: var(--accent-soft); border-color: transparent; color: var(--accent-ink); }\n.chip .x { border: 0; background: none; padding: 0 0 0 2px; cursor: pointer; color: inherit; opacity: .7; font-size: 14px; line-height: 1; }\n\n/* main */\n.main { padding: 20px 24px 60px; min-width: 0; }\n.filterbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 10px; }\n.filterbar .label { color: var(--muted); font-size: 13px; }\n.filterbar .clear { border: 0; background: none; color: var(--accent-ink); cursor: pointer; font-size: 13px; }\n.result-meta { color: var(--muted); font-size: 13px; margin-bottom: 12px; }\n\n.files.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 14px; }\n.card { position: relative; display: flex; flex-direction: column; border-radius: var(--radius); background: var(--panel); border: 1px solid var(--line); overflow: hidden; cursor: pointer; transition: transform .12s, box-shadow .12s; text-align: left; padding: 0; }\n.card:hover { transform: translateY(-2px); box-shadow: var(--shadow); }\n.card .thumb { display: grid; place-items: center; aspect-ratio: 4 / 3; background: var(--panel-2); overflow: hidden; }\n.card .thumb img { width: 100%; height: 100%; object-fit: cover; }\n.card .thumb .ficon { width: 64px; height: 78px; }\n.card .info { padding: 10px 12px 12px; display: grid; gap: 4px; }\n.card .fname { font-weight: 600; font-size: 13px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-all; min-height: 2.9em; }\n.card .meta { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; }\n.card .meta .avatar { width: 18px; height: 18px; font-size: 10px; }\n.card .meta .who { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n\n.files.list { display: block; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }\n.row { display: grid; grid-template-columns: 36px minmax(0, 2.4fr) minmax(0, 1.2fr) minmax(0, 1.6fr) 90px 120px; align-items: center; gap: 14px; padding: 10px 16px; border-bottom: 1px solid var(--line); cursor: pointer; }\n.row:last-child { border-bottom: 0; }\n.row:hover { background: var(--panel-2); }\n.row.head { cursor: default; background: var(--panel-2); color: var(--muted); font-size: 12px; font-weight: 600; padding-top: 8px; padding-bottom: 8px; }\n.row .ficon { width: 28px; height: 34px; }\n.row .fname { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.row .sub { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.row .who { display: flex; align-items: center; gap: 8px; min-width: 0; }\n.row .who span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.row .tags { display: flex; gap: 4px; overflow: hidden; }\n.row .num { color: var(--muted); font-variant-numeric: tabular-nums; text-align: right; }\n\n.empty { display: grid; justify-items: center; gap: 6px; padding: 80px 20px; color: var(--muted); text-align: center; }\n.empty svg { width: 64px; height: 64px; stroke-width: 2; opacity: .6; }\n.empty p { margin: 8px 0 0; font-size: 16px; color: var(--text); }\n\n/* drawer */\n.drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 40; width: min(440px, 100vw); background: var(--panel); border-left: 1px solid var(--line); box-shadow: -10px 0 40px rgba(0,0,0,.12); transform: translateX(105%); transition: transform .2s ease; display: flex; flex-direction: column; }\n.drawer.open { transform: none; }\n.drawer-head { display: flex; align-items: center; gap: 8px; padding: 12px 12px 12px 20px; border-bottom: 1px solid var(--line); }\n.drawer-head h2 { flex: 1; margin: 0; font-size: 15px; }\n.drawer-body { flex: 1; overflow-y: auto; padding: 20px; display: grid; gap: 18px; align-content: start; }\n.preview { display: grid; place-items: center; min-height: 180px; border-radius: var(--radius); background: var(--panel-2); overflow: hidden; }\n.preview img, .preview video { max-width: 100%; max-height: 320px; display: block; }\n.preview iframe { width: 100%; height: 360px; border: 0; background: #fff; }\n.preview audio { width: 90%; }\n.preview .ficon { width: 88px; height: 106px; }\n.d-name { font-size: 16px; font-weight: 700; word-break: break-all; margin: 0; }\n.kv { display: grid; grid-template-columns: 76px 1fr; gap: 8px 12px; margin: 0; font-size: 13px; }\n.kv dt { color: var(--muted); }\n.kv dd { margin: 0; word-break: break-all; }\n.kv a { color: var(--accent-ink); font-weight: 600; }\n.field label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 6px; font-weight: 600; }\n.tag-edit { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; border: 1px solid var(--line); border-radius: 10px; }\n.tag-edit input { flex: 1; min-width: 100px; border: 0; outline: 0; background: transparent; padding: 3px 4px; }\n.field select { width: 100%; }\n.d-actions { display: flex; gap: 8px; flex-wrap: wrap; }\n.hint { color: var(--muted); font-size: 12px; margin-top: 4px; }\n\n.dropzone { position: fixed; inset: 0; z-index: 60; display: none; place-items: center; background: rgba(6,199,85,.12); border: 3px dashed var(--accent); font-size: 20px; font-weight: 700; color: var(--accent-ink); }\n.dropzone.show { display: grid; }\n.toast { position: fixed; left: 50%; bottom: 24px; z-index: 70; transform: translate(-50%, 20px); opacity: 0; padding: 10px 16px; border-radius: 10px; background: #1c2026; color: #fff; transition: .2s; pointer-events: none; }\n.toast.show { opacity: 1; transform: translate(-50%, 0); }\n\n@media (max-width: 900px) {\n  .row { grid-template-columns: 32px minmax(0, 1fr) 110px 70px; }\n  .row .c-tags, .row .c-date { display: none; }\n}\n@media (max-width: 760px) {\n  .only-mobile { display: grid; }\n  .topbar { flex-wrap: wrap; gap: 8px 10px; padding: 10px 16px; }\n  .brand-name { display: none; }\n  .search { order: 3; flex-basis: 100%; max-width: none; }\n  .top-actions select { width: 104px; }\n  .btn span { display: none; }\n  .layout { grid-template-columns: 1fr; }\n  .sidebar { position: fixed; top: 0; left: 0; bottom: 0; height: 100vh; z-index: 50; width: 280px; transform: translateX(-105%); transition: transform .2s; }\n  .sidebar.open { transform: none; }\n  .scrim { position: fixed; inset: 0; z-index: 45; background: rgba(0,0,0,.35); display: none; }\n  .scrim.show { display: block; }\n  .main { padding: 14px 16px 60px; }\n  .files.grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }\n  .row { grid-template-columns: 30px minmax(0, 1fr) 64px; padding: 10px 12px; }\n  .row .c-who { display: none; }\n}\n\n/* ---------- 共用：連結、提示 ---------- */\na.brand { color: inherit; text-decoration: none; }\n.muted { color: var(--muted); }\n.banner { display: block; margin-bottom: 14px; padding: 12px 16px; border-radius: 10px; background: #fff7e0; color: #8a5a00; text-decoration: none; font-weight: 600; border: 1px solid #f3dc9a; }\n@media (prefers-color-scheme: dark) { .banner { background: #33290f; color: #f5cf73; border-color: #5a4718; } }\n.result-meta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }\n.link-btn { display: inline-flex; align-items: center; gap: 4px; color: var(--accent-ink); text-decoration: none; font-weight: 600; cursor: pointer; }\n.link-btn svg { width: 16px; height: 16px; }\n.btn.ghost { border-color: transparent; background: transparent; color: var(--accent-ink); }\n.btn.small { height: 32px; font-size: 13px; }\n.btn.block { width: 100%; justify-content: center; }\n.btn svg { width: 18px; height: 18px; }\n.tabs { display: flex; gap: 4px; }\n.tabs a { padding: 7px 14px; border-radius: 9px; color: var(--muted); text-decoration: none; font-weight: 600; }\n.tabs a:hover { background: var(--panel-2); color: var(--text); }\n.tabs a.on { background: var(--accent-soft); color: var(--accent-ink); }\n\n/* ---------- 登入頁 ---------- */\n.auth-page { display: grid; place-items: center; min-height: 100vh; padding: 16px; }\n.auth-card { width: min(380px, 100%); padding: 32px 28px; border-radius: 16px; background: var(--panel); border: 1px solid var(--line); box-shadow: var(--shadow); }\n.auth-brand { justify-content: center; margin-bottom: 20px; }\n.auth-card h1 { margin: 0 0 4px; font-size: 22px; }\n.auth-card .muted { margin: 0 0 18px; }\n.form-error { color: var(--danger); min-height: 1.5em; margin: 0 0 8px; font-size: 13px; }\n\n/* ---------- 表單欄位 ---------- */\n.field { display: block; margin-bottom: 14px; }\n.field > span { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }\n.field small { font-weight: 400; }\n.field input, .field textarea, .copy-row input, .rt-row input, .rt-row select { width: 100%; padding: 9px 12px; border-radius: 9px; border: 1px solid var(--line); background: var(--panel); outline: none; font-family: inherit; }\n.field input:focus, .field textarea:focus, .rt-row input:focus, .rt-row select:focus { border-color: var(--accent); }\n.field textarea { resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }\n.field.inline { display: flex; align-items: center; gap: 10px; margin-top: 12px; }\n.field.inline > span { margin: 0; white-space: nowrap; }\n.field.inline input { max-width: 200px; }\n.copy-row { display: flex; gap: 8px; }\n.copy-row input { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; background: var(--panel-2); }\n.warn { color: #b45309; font-size: 13px; margin: 6px 0 0; }\n\n/* ---------- 設定頁 ---------- */\n.settings { max-width: 880px; margin: 0 auto; padding: 24px 16px 80px; display: grid; gap: 18px; }\n.box { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 22px 24px; min-width: 0; }\n.box h2 { margin: 0 0 6px; font-size: 17px; }\n.box h2 small { font-size: 12px; font-weight: 400; margin-left: 8px; }\n.box h3 { margin: 26px 0 4px; font-size: 15px; }\n.box > .muted { margin: 0 0 16px; font-size: 13px; }\n.row-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 14px; }\n.sticky-actions { margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--line); margin-bottom: 0; }\n\n.checklist { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }\n.checklist li { display: flex; gap: 12px; padding: 10px 6px; border-radius: 10px; }\n.checklist li:not(.done):not(.all-done) { background: var(--panel-2); }\n.checklist .dot { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--line); font-size: 13px; font-weight: 700; color: var(--muted); flex: none; }\n.checklist li.done .dot { background: var(--accent); border-color: var(--accent); color: #fff; }\n.checklist li.done b { color: var(--muted); font-weight: 500; }\n.checklist p { margin: 4px 0 0; font-size: 13px; color: var(--muted); }\n.checklist a { color: var(--accent-ink); }\n.checklist code { font-size: 12px; word-break: break-all; }\n.checklist .bad { color: var(--danger); }\n.checklist .all-done { font-weight: 600; color: var(--accent-ink); padding: 12px 6px 4px; }\n.collapsed .checklist li.done { display: none; }\n.collapsed > .muted { display: none; }\n\n.test-result { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 10px; background: var(--panel-2); margin-bottom: 14px; font-size: 13px; }\n.test-result img { width: 44px; height: 44px; border-radius: 50%; }\n.test-result.ok { background: var(--accent-soft); }\n.test-result.ok b { color: var(--accent-ink); }\n.test-result.bad { background: #fde8e8; color: var(--danger); }\n@media (prefers-color-scheme: dark) { .test-result.bad { background: #3a1717; } }\n\n.switch { display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 14px; }\n.switch input { width: 18px; height: 18px; accent-color: var(--accent); }\n\n.rules-table { display: grid; gap: 6px; margin-bottom: 10px; }\n.rt-head, .rt-row { display: grid; gap: 8px; align-items: center; }\n.rt-head { font-size: 12px; color: var(--muted); font-weight: 600; padding: 0 2px; }\n.cat { grid-template-columns: minmax(0, 1fr) 96px minmax(0, 2.2fr) 36px; }\n.kw { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) 36px; }\n.rt-row input, .rt-row select { padding: 7px 10px; font-size: 13px; }\n\n.pw-form { display: grid; grid-template-columns: 1fr 1fr auto; gap: 12px; align-items: end; }\n.pw-form .field { margin: 0; }\n\n.activity { list-style: none; margin: 10px 0 0; padding: 0; max-height: 320px; overflow-y: auto; font-size: 13px; border: 1px solid var(--line); border-radius: 10px; }\n.activity li { display: flex; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--line); }\n.activity li:last-child { border-bottom: 0; }\n.activity time { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }\n.activity .lv-warn span { color: #b45309; }\n.activity .lv-error span { color: var(--danger); }\n\n@media (max-width: 640px) {\n  .box { padding: 18px 16px; }\n  .tabs a { padding: 6px 10px; }\n  .cat, .kw { grid-template-columns: 1fr 1fr 36px; }\n  .rt-head { display: none; }\n  .cat input[data-k=\"exts\"], .kw input[data-k=\"keywords\"] { grid-column: 1 / 3; grid-row: 2; }\n  .rt-row { padding-bottom: 8px; border-bottom: 1px dashed var(--line); }\n  .pw-form { grid-template-columns: 1fr; }\n  .activity li { flex-direction: column; gap: 0; }\n}\n\n/* ---------- Google 版新增 ---------- */\nbody { overflow-x: hidden; }\n.view[hidden] { display: none !important; }\n.storage-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; margin-bottom: 8px; }\n.storage-card { position: relative; display: grid; gap: 6px; align-content: start; padding: 16px; border: 1.5px solid var(--line); border-radius: 12px; background: var(--panel); text-align: left; }\n.storage-card.active { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }\n.storage-card.disabled { opacity: .7; background: var(--panel-2); }\n.storage-card .s-head { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 15px; }\n.storage-card .s-logo { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; color: #fff; font-weight: 800; font-size: 14px; flex: none; }\n.storage-card .s-state { font-size: 12px; color: var(--muted); word-break: break-all; }\n.storage-card .s-state.on { color: var(--accent-ink); font-weight: 600; }\n.storage-card .s-badge { position: absolute; top: 12px; right: 12px; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--accent); color: #fff; }\n.storage-card .s-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }\n.connect-panel { margin-top: 14px; padding: 16px; border-radius: 12px; background: var(--panel-2); }\n.connect-panel h3 { margin: 0 0 6px; font-size: 15px; }\n.connect-panel ol { margin: 6px 0 14px; padding-left: 20px; font-size: 13px; color: var(--muted); display: grid; gap: 4px; }\n.connect-panel ol b, .connect-panel ol code { color: var(--text); }\n.device-code { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 14px; border-radius: 10px; background: var(--panel); border: 1px dashed var(--accent); margin: 10px 0; }\n.device-code .code { font: 700 26px/1 ui-monospace, Menlo, monospace; letter-spacing: .12em; color: var(--accent-ink); }\n.note { font-size: 12px; color: var(--muted); margin: 8px 0 0; }\n.spinner { width: 16px; height: 16px; border: 2px solid var(--line); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; display: inline-block; vertical-align: -3px; }\n@keyframes spin { to { transform: rotate(360deg); } }\n.loading { display: grid; place-items: center; min-height: 60vh; color: var(--muted); gap: 10px; }\n.thumb-loading { opacity: .5; }\n.d-actions a.btn { text-decoration: none; }\n\n</style>\n</head>\n<body>\n<!-- 載入中 -->\n<div class=\"loading\" id=\"loadingView\"><span class=\"spinner\"></span><span>載入中…</span></div>\n\n<!-- 登入 / 首次設定 -->\n<div class=\"view auth-page\" id=\"authView\" hidden>\n  <main class=\"auth-card\">\n    <div class=\"brand auth-brand\">\n      <span class=\"brand-mark\"><svg viewBox=\"0 0 24 24\"><path d=\"M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/></svg></span>\n      <span>LINE 檔案櫃</span>\n    </div>\n    <form id=\"authForm\">\n      <h1 id=\"authTitle\">登入</h1>\n      <p id=\"authLead\" class=\"muted\">輸入管理密碼</p>\n      <label class=\"field\"><span>密碼</span><input id=\"pw\" type=\"password\" autocomplete=\"current-password\" required></label>\n      <label class=\"field\" id=\"pw2Wrap\" hidden><span>再輸入一次</span><input id=\"pw2\" type=\"password\" autocomplete=\"new-password\"></label>\n      <p class=\"form-error\" id=\"authErr\" role=\"alert\"></p>\n      <button class=\"btn primary block\" id=\"authBtn\">登入</button>\n    </form>\n  </main>\n</div>\n\n<!-- 主畫面 -->\n<div class=\"view\" id=\"appView\" hidden>\n<header class=\"topbar\">\n  <button class=\"icon-btn only-mobile\" id=\"menuBtn\" aria-label=\"開啟篩選選單\" data-only=\"files\">\n    <svg viewBox=\"0 0 24 24\"><path d=\"M4 6h16M4 12h16M4 18h16\"/></svg>\n  </button>\n  <div class=\"brand\">\n    <span class=\"brand-mark\"><svg viewBox=\"0 0 24 24\"><path d=\"M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/></svg></span>\n    <span class=\"brand-name\">LINE 檔案櫃</span>\n  </div>\n  <nav class=\"tabs\">\n    <a href=\"#files\" data-tab=\"files\" class=\"on\">檔案</a>\n    <a href=\"#settings\" data-tab=\"settings\">設定</a>\n  </nav>\n  <label class=\"search\" data-only=\"files\">\n    <svg viewBox=\"0 0 24 24\"><circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"m20 20-3.5-3.5\"/></svg>\n    <input id=\"q\" type=\"search\" placeholder=\"搜尋檔名、上傳者、標籤…\" autocomplete=\"off\">\n  </label>\n  <div class=\"top-actions\">\n    <select id=\"sort\" aria-label=\"排序\" data-only=\"files\">\n      <option value=\"newest\">最新上傳</option>\n      <option value=\"oldest\">最早上傳</option>\n      <option value=\"name\">檔名</option>\n      <option value=\"size\">檔案大小</option>\n    </select>\n    <div class=\"seg\" role=\"group\" aria-label=\"顯示方式\" data-only=\"files\">\n      <button data-view=\"grid\" title=\"圖示顯示\" aria-label=\"圖示顯示\"><svg viewBox=\"0 0 24 24\"><rect x=\"4\" y=\"4\" width=\"6.5\" height=\"6.5\" rx=\"1.5\"/><rect x=\"13.5\" y=\"4\" width=\"6.5\" height=\"6.5\" rx=\"1.5\"/><rect x=\"4\" y=\"13.5\" width=\"6.5\" height=\"6.5\" rx=\"1.5\"/><rect x=\"13.5\" y=\"13.5\" width=\"6.5\" height=\"6.5\" rx=\"1.5\"/></svg></button>\n      <button data-view=\"list\" title=\"清單顯示\" aria-label=\"清單顯示\"><svg viewBox=\"0 0 24 24\"><path d=\"M9 6h11M9 12h11M9 18h11\"/><circle cx=\"4.5\" cy=\"6\" r=\"1\"/><circle cx=\"4.5\" cy=\"12\" r=\"1\"/><circle cx=\"4.5\" cy=\"18\" r=\"1\"/></svg></button>\n    </div>\n    <button class=\"icon-btn\" id=\"refreshBtn\" title=\"重新整理\" aria-label=\"重新整理\" data-only=\"files\"><svg viewBox=\"0 0 24 24\"><path d=\"M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5\"/></svg></button>\n    <button class=\"btn\" id=\"logoutBtn\">登出</button>\n  </div>\n</header>\n\n<!-- 檔案頁 -->\n<div class=\"layout\" id=\"filesTab\">\n  <aside class=\"sidebar\" id=\"sidebar\">\n    <div class=\"stat\">\n      <div><b id=\"statCount\">0</b><span>個檔案</span></div>\n      <div><b id=\"statSize\">0 B</b><span>總容量</span></div>\n    </div>\n    <nav>\n      <h3>分類資料夾</h3>\n      <ul id=\"catList\" class=\"facet\"></ul>\n      <h3>上傳者</h3>\n      <ul id=\"uploaderList\" class=\"facet\"></ul>\n      <h3 id=\"groupHead\">群組</h3>\n      <ul id=\"groupList\" class=\"facet\"></ul>\n      <h3>標籤</h3>\n      <div id=\"tagCloud\" class=\"tag-cloud\"></div>\n    </nav>\n  </aside>\n  <div class=\"scrim only-mobile\" id=\"scrim\"></div>\n  <main class=\"main\">\n    <a class=\"banner\" id=\"setupBanner\" href=\"#settings\" hidden>⚙️ 還沒連接 LINE Bot，點這裡到「設定」完成設定 →</a>\n    <div class=\"filterbar\" id=\"filterbar\" hidden></div>\n    <div class=\"result-meta\"><span id=\"resultText\"></span>\n      <a class=\"link-btn\" id=\"sheetLink\" target=\"_blank\" rel=\"noopener\" hidden>在 Google 試算表開啟清單 ↗</a>\n    </div>\n    <section id=\"files\" class=\"files grid\" aria-live=\"polite\"></section>\n    <div class=\"empty\" id=\"empty\" hidden>\n      <svg viewBox=\"0 0 64 64\"><path d=\"M8 20h18l4 4h26v26a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4z\"/><path d=\"M24 38h16\"/></svg>\n      <p id=\"emptyText\">還沒有檔案</p>\n      <small>把 Bot 加進 LINE 群組，成員上傳的檔案就會自動出現在這裡。</small>\n    </div>\n  </main>\n</div>\n\n<!-- 設定頁 -->\n<main class=\"settings\" id=\"settingsTab\" hidden>\n  <section class=\"box\" id=\"checklistCard\">\n    <h2>開始使用</h2>\n    <p class=\"muted\">照著下面的步驟做，每完成一步就會自動打勾。</p>\n    <ol class=\"checklist\" id=\"checklist\"></ol>\n  </section>\n\n  <section class=\"box\" id=\"lineBox\">\n    <h2>LINE 連線</h2>\n    <div class=\"field\">\n      <span>Webhook 網址 <small class=\"muted\">— 整串貼到 LINE Developers › Messaging API › Webhook URL</small></span>\n      <div class=\"copy-row\"><input id=\"webhookUrl\" readonly><button class=\"btn\" id=\"copyWebhook\">複製</button></div>\n      <p class=\"note\">網址最後的 <code>?key=…</code> 是防止別人冒充 LINE 的密碼，請整串複製，不要外流。</p>\n    </div>\n    <label class=\"field\">\n      <span>Channel access token <small class=\"muted\">— Messaging API 分頁最下方，按 Issue 產生</small></span>\n      <textarea id=\"token\" rows=\"3\" autocomplete=\"off\" spellcheck=\"false\"></textarea>\n    </label>\n    <div class=\"row-actions\">\n      <button class=\"btn primary\" id=\"saveLine\">儲存並測試</button>\n      <button class=\"btn\" id=\"testLine\">只測試連線</button>\n      <a class=\"btn ghost\" href=\"https://developers.line.biz/console/\" target=\"_blank\" rel=\"noopener\">開啟 LINE Developers ↗</a>\n    </div>\n    <div class=\"test-result\" id=\"testResult\" hidden></div>\n    <label class=\"switch\"><input type=\"checkbox\" id=\"replyOnSave\"><span>收到檔案後在群組回覆「📁 已收到…」</span></label>\n  </section>\n\n  <section class=\"box\" id=\"storageBox\">\n    <h2>儲存位置</h2>\n    <p class=\"muted\">選擇新收到的檔案要存到哪裡。切換後，舊檔案會留在原本的位置，管理介面仍然看得到。</p>\n    <div class=\"storage-grid\" id=\"storageGrid\"></div>\n    <div id=\"connectPanel\"></div>\n    <label class=\"field inline\"><span>根資料夾名稱</span><input id=\"rootFolder\" maxlength=\"60\"><button class=\"btn small\" id=\"saveRoot\">儲存</button></label>\n  </section>\n\n  <section class=\"box\" id=\"rulesBox\">\n    <h2>分類規則</h2>\n    <p class=\"muted\">依副檔名決定放進哪個資料夾。副檔名用逗號或空白分開。</p>\n    <div class=\"rules-table\" id=\"catTable\"></div>\n    <button class=\"btn small\" id=\"addCat\">＋ 新增分類</button>\n    <label class=\"field inline\"><span>其他檔案放到</span><input id=\"fallbackName\" maxlength=\"30\"></label>\n    <h3>檔名關鍵字</h3>\n    <p class=\"muted\">檔名包含任一個關鍵字，就自動加上標籤；有填子資料夾的話，會放進「分類/子資料夾」。</p>\n    <div class=\"rules-table\" id=\"kwTable\"></div>\n    <button class=\"btn small\" id=\"addKw\">＋ 新增關鍵字規則</button>\n    <div class=\"row-actions sticky-actions\">\n      <button class=\"btn primary\" id=\"saveRules\">儲存規則</button>\n      <button class=\"btn\" id=\"reclassify\">依新規則重新整理現有檔案</button>\n      <button class=\"btn ghost\" id=\"resetRules\">還原預設規則</button>\n    </div>\n  </section>\n\n  <section class=\"box\">\n    <h2>變更管理密碼</h2>\n    <form id=\"pwForm\" class=\"pw-form\">\n      <label class=\"field\"><span>目前密碼</span><input type=\"password\" id=\"pwCur\" autocomplete=\"current-password\" required></label>\n      <label class=\"field\"><span>新密碼（至少 6 個字）</span><input type=\"password\" id=\"pwNew\" autocomplete=\"new-password\" minlength=\"6\" required></label>\n      <button class=\"btn\">變更密碼</button>\n    </form>\n  </section>\n\n  <section class=\"box\">\n    <h2>活動紀錄 <small class=\"muted\" id=\"statusLine\"></small></h2>\n    <ul class=\"activity\" id=\"activity\"></ul>\n  </section>\n</main>\n</div>\n\n<aside class=\"drawer\" id=\"drawer\" aria-hidden=\"true\">\n  <div class=\"drawer-head\">\n    <h2 id=\"dTitle\">檔案資訊</h2>\n    <button class=\"icon-btn\" id=\"dClose\" aria-label=\"關閉\"><svg viewBox=\"0 0 24 24\"><path d=\"M6 6l12 12M18 6 6 18\"/></svg></button>\n  </div>\n  <div class=\"drawer-body\" id=\"dBody\"></div>\n</aside>\n<div class=\"toast\" id=\"toast\" role=\"status\"></div>\n\n<script>\n'use strict';\nconst $ = s => document.querySelector(s);\nconst esc = s => String(s == null ? '' : s).replace(/[&<>\"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]));\nconst store = {\n  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },\n  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} },\n};\nlet token = store.get('lfb_token');\n\n/** 呼叫 Apps Script 伺服器函式（自動帶上登入 token） */\nfunction call(fn, ...args) {\n  return new Promise((resolve, reject) => {\n    google.script.run\n      .withSuccessHandler(resolve)\n      .withFailureHandler(err => {\n        const msg = (err && err.message) || String(err);\n        if (msg.indexOf('AUTH:') >= 0) { token = null; store.set('lfb_token', null); showAuth(); }\n        reject(new Error(msg.replace(/^.*?AUTH:\\s*/, '').replace(/^Error:\\s*/, '')));\n      })[fn](...args);\n  });\n}\nconst api = (fn, ...args) => call(fn, token, ...args);\n\nfunction toast(msg) {\n  const t = $('#toast'); t.textContent = msg; t.classList.add('show');\n  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);\n}\nasync function copyText(text, input) {\n  try { await navigator.clipboard.writeText(text); }\n  catch (e) { input.focus(); input.select(); try { document.execCommand('copy'); } catch (e2) {} }\n  toast('已複製');\n}\n\nconst fmtSize = b => { if (!b) return '0 B'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(4, Math.floor(Math.log(b) / Math.log(1024))); return (b / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i]; };\nconst fmtDate = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }) + ' ' + d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }); };\nconst fmtShort = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }); };\nconst fmtTime = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }) + ' ' + d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); };\n\n// ================= 登入 =================\nlet setupMode = false;\nfunction showView(id) { ['loadingView', 'authView', 'appView'].forEach(v => { $('#' + v).hidden = v !== id; }); }\nasync function showAuth() {\n  showView('authView');\n  const s = await call('apiSession', token);\n  setupMode = !s.configured;\n  $('#authTitle').textContent = setupMode ? '歡迎使用 👋' : '登入';\n  $('#authLead').textContent = setupMode ? '第一步：建立管理密碼，之後用它登入這個管理介面（至少 6 個字）。' : '輸入管理密碼';\n  $('#pw2Wrap').hidden = !setupMode; $('#pw2').required = setupMode;\n  $('#authBtn').textContent = setupMode ? '建立密碼並開始' : '登入';\n  $('#pw').focus();\n}\n$('#authForm').addEventListener('submit', async e => {\n  e.preventDefault();\n  $('#authErr').textContent = '';\n  $('#authBtn').disabled = true;\n  try {\n    if (setupMode && $('#pw').value !== $('#pw2').value) throw new Error('兩次輸入的密碼不一樣');\n    token = await call(setupMode ? 'apiSetup' : 'apiLogin', $('#pw').value);\n    store.set('lfb_token', token);\n    $('#pw').value = $('#pw2').value = '';\n    startApp(setupMode ? 'settings' : 'files');\n  } catch (err) { $('#authErr').textContent = err.message; }\n  finally { $('#authBtn').disabled = false; }\n});\n$('#logoutBtn').onclick = async () => { await api('apiLogout').catch(() => {}); token = null; store.set('lfb_token', null); showAuth(); };\n\n// ================= 分頁 =================\nlet currentTab = 'files';\nfunction setTab(tab) {\n  currentTab = tab;\n  document.querySelectorAll('[data-tab]').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));\n  document.querySelectorAll('[data-only]').forEach(el => { el.style.display = el.dataset.only === tab ? '' : 'none'; });\n  $('#filesTab').hidden = tab !== 'files';\n  $('#settingsTab').hidden = tab !== 'settings';\n  if (tab === 'settings') loadSettings(); else loadFiles();\n  window.scrollTo(0, 0);\n}\ndocument.addEventListener('click', e => {\n  const a = e.target.closest('[data-tab], a[href=\"#settings\"]');\n  if (!a) return;\n  e.preventDefault();\n  setTab(a.dataset.tab || 'settings');\n});\n\nasync function startApp(tab) {\n  showView('appView');\n  setTab(tab || 'files');\n}\n\n// ================= 檔案頁 =================\nconst TYPE_COLORS = { doc: '#2f6fde', sheet: '#16a34a', slide: '#ea7a1a', image: '#8b5cf6', video: '#e0457b', audio: '#0ea5a4', archive: '#a16207', design: '#c026d3', code: '#475569', file: '#7c8594' };\nconst EXT_COLORS = { pdf: '#e0383e', txt: '#64748b' };\nfunction fileIcon(icon, ext, cls) {\n  const color = EXT_COLORS[ext] || TYPE_COLORS[icon] || TYPE_COLORS.file;\n  const label = (ext || icon || 'file').slice(0, 4).toUpperCase();\n  const glyph = {\n    image: '<circle cx=\"23\" cy=\"28\" r=\"4\"/><path d=\"M14 46l10-10 6 6 6-8 10 12z\"/>', video: '<path d=\"M25 25v16l13-8z\"/>',\n    audio: '<path d=\"M27 40V24l12-3v16\"/><circle cx=\"24\" cy=\"40\" r=\"3\"/><circle cx=\"36\" cy=\"37\" r=\"3\"/>',\n    archive: '<path d=\"M30 14v4m0 4v4m0 4v4\"/><rect x=\"26\" y=\"34\" width=\"8\" height=\"8\" rx=\"1.5\"/>',\n    sheet: '<rect x=\"16\" y=\"22\" width=\"28\" height=\"22\" rx=\"2\"/><path d=\"M16 29h28M16 36h28M26 22v22\"/>',\n    slide: '<rect x=\"15\" y=\"22\" width=\"30\" height=\"20\" rx=\"2\"/><path d=\"M22 36l6-6 4 4 6-6\"/>', code: '<path d=\"M24 26l-7 7 7 7M36 26l7 7-7 7\"/>',\n    design: '<circle cx=\"30\" cy=\"32\" r=\"10\"/><path d=\"M30 22v20M20 32h20\"/>',\n  }[icon] || '<path d=\"M18 26h24M18 32h24M18 38h16\"/>';\n  return '<svg class=\"' + (cls || 'ficon') + '\" viewBox=\"0 0 60 72\" aria-hidden=\"true\">' +\n    '<path d=\"M6 4h34l14 14v48a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z\" fill=\"var(--panel)\" stroke=\"' + color + '\" stroke-width=\"2.4\"/>' +\n    '<path d=\"M40 4v10a4 4 0 0 0 4 4h10\" fill=\"none\" stroke=\"' + color + '\" stroke-width=\"2.4\"/>' +\n    '<g stroke=\"' + color + '\" stroke-width=\"2.4\" fill=\"none\" opacity=\".55\">' + glyph + '</g>' +\n    '<rect x=\"2\" y=\"50\" width=\"44\" height=\"16\" rx=\"3\" fill=\"' + color + '\" stroke=\"none\"/>' +\n    '<text x=\"24\" y=\"62\" text-anchor=\"middle\" font-size=\"11\" font-weight=\"700\" fill=\"#fff\" stroke=\"none\" font-family=\"system-ui, sans-serif\">' + esc(label) + '</text></svg>';\n}\nconst AVATAR_COLORS = ['#06c755', '#2f6fde', '#ea7a1a', '#8b5cf6', '#e0457b', '#0ea5a4', '#a16207', '#475569'];\nfunction avatar(name) {\n  let h = 0; for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;\n  return '<span class=\"avatar\" style=\"background:' + AVATAR_COLORS[h % AVATAR_COLORS.length] + '\">' + esc(Array.from(String(name))[0] || '?') + '</span>';\n}\n\nconst state = { all: [], files: [], categories: [], q: '', category: '', tags: new Set(), sort: 'newest', view: store.get('view') || 'grid', current: null, thumbs: {} };\n\nasync function loadFiles() {\n  try {\n    const r = await api('apiFiles');\n    state.all = r.files; state.categories = r.categories;\n    $('#sheetLink').href = r.sheetUrl; $('#sheetLink').hidden = false;\n    applyFilters(); renderSidebar();\n  } catch (e) { toast(e.message); }\n  api('apiSettings').then(s => { $('#setupBanner').hidden = s.lineTokenSet; }).catch(() => {});\n}\n\nfunction applyFilters() {\n  const needle = state.q.toLowerCase();\n  const list = state.all.filter(f =>\n    (!state.category || f.category === state.category) &&\n    Array.from(state.tags).every(t => f.tags.indexOf(t) >= 0) &&\n    (!needle || [f.name, f.uploader, f.source].concat(f.tags).join(' ').toLowerCase().indexOf(needle) >= 0));\n  const cmp = {\n    newest: (a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)),\n    oldest: (a, b) => String(a.uploadedAt).localeCompare(String(b.uploadedAt)),\n    name: (a, b) => a.name.localeCompare(b.name, 'zh-Hant'),\n    size: (a, b) => b.size - a.size,\n  }[state.sort];\n  state.files = list.sort(cmp);\n  renderFiles(); renderFilterbar();\n}\n\nfunction facets() {\n  const tagCount = {}, catCount = {};\n  state.all.forEach(f => {\n    catCount[f.category] = (catCount[f.category] || 0) + 1;\n    f.tags.forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; });\n  });\n  const tags = Object.keys(tagCount).map(n => ({ name: n, count: tagCount[n] })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));\n  return {\n    catCount: catCount,\n    uploaders: tags.filter(t => t.name[0] === '@'),\n    groups: tags.filter(t => t.name.indexOf('群:') === 0),\n    tags: tags.filter(t => t.name[0] !== '@' && t.name.indexOf('群:') !== 0 && !catCount[t.name]),\n  };\n}\n\nfunction renderSidebar() {\n  const f = facets();\n  $('#statCount').textContent = state.all.length;\n  $('#statSize').textContent = fmtSize(state.all.reduce((s, x) => s + x.size, 0));\n  $('#catList').innerHTML = '<li><button data-cat=\"\" class=\"' + (state.category ? '' : 'on') + '\">' + fileIcon('file', 'all', 'mini-icon') + '<span class=\"name\">全部檔案</span><span class=\"count\">' + state.all.length + '</span></button></li>' +\n    state.categories.map(c => '<li><button data-cat=\"' + esc(c.name) + '\" class=\"' + (state.category === c.name ? 'on' : '') + ' ' + (f.catCount[c.name] ? '' : 'zero') + '\">' + fileIcon(c.icon, '', 'mini-icon') + '<span class=\"name\">' + esc(c.name) + '</span><span class=\"count\">' + (f.catCount[c.name] || 0) + '</span></button></li>').join('');\n  $('#uploaderList').innerHTML = f.uploaders.map(u => { const n = u.name.slice(1); return '<li><button data-tag=\"' + esc(u.name) + '\" class=\"' + (state.tags.has(u.name) ? 'on' : '') + '\">' + avatar(n) + '<span class=\"name\">' + esc(n) + '</span><span class=\"count\">' + u.count + '</span></button></li>'; }).join('') || '<li class=\"hint\" style=\"padding:0 8px\">尚無</li>';\n  $('#groupHead').hidden = !f.groups.length;\n  $('#groupList').innerHTML = f.groups.map(g => '<li><button data-tag=\"' + esc(g.name) + '\" class=\"' + (state.tags.has(g.name) ? 'on' : '') + '\"><svg viewBox=\"0 0 24 24\"><circle cx=\"9\" cy=\"9\" r=\"3.2\"/><circle cx=\"17\" cy=\"10\" r=\"2.5\"/><path d=\"M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5M15 15.2c2.6-.6 5.3.7 6 3.8\"/></svg><span class=\"name\">' + esc(g.name.slice(2)) + '</span><span class=\"count\">' + g.count + '</span></button></li>').join('');\n  $('#tagCloud').innerHTML = f.tags.map(t => '<button class=\"chip ' + (state.tags.has(t.name) ? 'on' : '') + '\" data-tag=\"' + esc(t.name) + '\">' + esc(t.name) + ' <span style=\"opacity:.6\">' + t.count + '</span></button>').join('') || '<span class=\"hint\">尚無標籤</span>';\n}\n$('#sidebar').addEventListener('click', e => {\n  const b = e.target.closest('button'); if (!b) return;\n  if (b.dataset.cat !== undefined) state.category = b.dataset.cat;\n  else if (b.dataset.tag) { state.tags.has(b.dataset.tag) ? state.tags.delete(b.dataset.tag) : state.tags.add(b.dataset.tag); }\n  else return;\n  renderSidebar(); applyFilters(); closeSidebar();\n});\n\nfunction tagLabel(t) { return t[0] === '@' ? '👤 ' + t.slice(1) : t.indexOf('群:') === 0 ? '👥 ' + t.slice(2) : '# ' + t; }\nfunction renderFilterbar() {\n  const items = [];\n  if (state.category) items.push('<span class=\"chip on\" data-rm-cat>📁 ' + esc(state.category) + ' <button class=\"x\" aria-label=\"移除\">×</button></span>');\n  state.tags.forEach(t => items.push('<span class=\"chip on\" data-rm-tag=\"' + esc(t) + '\">' + esc(tagLabel(t)) + ' <button class=\"x\" aria-label=\"移除\">×</button></span>'));\n  $('#filterbar').hidden = !items.length;\n  $('#filterbar').innerHTML = '<span class=\"label\">篩選：</span>' + items.join('') + '<button class=\"clear\" data-clear>清除全部</button>';\n  const who = Array.from(state.tags).filter(t => t[0] === '@').map(t => t.slice(1));\n  $('#resultText').textContent = (who.length === 1 ? who[0] + ' 上傳的檔案 · ' : '') + '共 ' + state.files.length + ' 個檔案' + (state.q ? '（搜尋「' + state.q + '」）' : '');\n}\n$('#filterbar').addEventListener('click', e => {\n  const c = e.target.closest('[data-rm-cat],[data-rm-tag],[data-clear]'); if (!c) return;\n  if (c.hasAttribute('data-clear')) { state.category = ''; state.tags.clear(); }\n  else if (c.hasAttribute('data-rm-cat')) state.category = '';\n  else state.tags.delete(c.dataset.rmTag);\n  renderSidebar(); applyFilters();\n});\n\nconst isImage = f => f.icon === 'image' && f.ext !== 'heic';\nfunction thumbHtml(f, big) {\n  const t = state.thumbs[f.id];\n  if (isImage(f) && t) return '<img loading=\"lazy\" src=\"' + esc(t) + '\" alt=\"\">';\n  return fileIcon(f.icon, f.ext) ;\n}\nfunction renderFiles() {\n  const el = $('#files');\n  el.className = 'files ' + state.view;\n  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.view === state.view));\n  $('#empty').hidden = state.files.length > 0;\n  $('#emptyText').textContent = state.all.length ? '沒有符合條件的檔案' : '還沒有檔案';\n  if (!state.files.length) { el.innerHTML = ''; return; }\n  if (state.view === 'grid') {\n    el.innerHTML = state.files.map(f =>\n      '<button class=\"card\" data-id=\"' + esc(f.id) + '\" title=\"' + esc(f.name) + '\">' +\n      '<div class=\"thumb\" data-thumb=\"' + esc(f.id) + '\">' + thumbHtml(f) + '</div>' +\n      '<div class=\"info\"><div class=\"fname\">' + esc(f.name) + '</div>' +\n      '<div class=\"meta\">' + avatar(f.uploader) + '<span class=\"who\">' + esc(f.uploader) + '</span><span>' + fmtShort(f.uploadedAt) + '</span></div></div></button>').join('');\n    loadThumbs();\n  } else {\n    el.innerHTML = '<div class=\"row head\"><span></span><span>檔名</span><span class=\"c-who\">上傳者</span><span class=\"c-tags\">標籤</span><span class=\"num\">大小</span><span class=\"num c-date\">上傳時間</span></div>' +\n      state.files.map(f =>\n        '<div class=\"row\" data-id=\"' + esc(f.id) + '\" tabindex=\"0\">' + fileIcon(f.icon, f.ext) +\n        '<div style=\"min-width:0\"><div class=\"fname\">' + esc(f.name) + '</div><div class=\"sub\">' + esc(f.folder) + '</div></div>' +\n        '<div class=\"who c-who\">' + avatar(f.uploader) + '<span>' + esc(f.uploader) + '</span></div>' +\n        '<div class=\"tags c-tags\">' + f.tags.filter(t => t[0] !== '@' && t !== f.category).slice(0, 3).map(t => '<span class=\"chip\">' + esc(t.indexOf('群:') === 0 ? t.slice(2) : t) + '</span>').join('') + '</div>' +\n        '<div class=\"num\">' + fmtSize(f.size) + '</div><div class=\"num c-date\">' + fmtDate(f.uploadedAt) + '</div></div>').join('');\n  }\n}\nlet thumbBusy = false;\nasync function loadThumbs() {\n  if (thumbBusy) return;\n  const need = state.files.filter(f => isImage(f) && !(f.id in state.thumbs)).slice(0, 24).map(f => f.id);\n  if (!need.length) return;\n  thumbBusy = true;\n  try {\n    const got = await api('apiThumbs', need);\n    need.forEach(id => { state.thumbs[id] = got[id] || null; });\n    need.forEach(id => {\n      const box = document.querySelector('[data-thumb=\"' + id + '\"]');\n      const f = state.all.filter(x => x.id === id)[0];\n      if (box && f) box.innerHTML = thumbHtml(f);\n    });\n  } catch (e) { need.forEach(id => { state.thumbs[id] = null; }); }\n  thumbBusy = false;\n  if (state.files.some(f => isImage(f) && !(f.id in state.thumbs))) loadThumbs();\n}\n$('#files').addEventListener('click', e => { const it = e.target.closest('[data-id]'); if (it) openDrawer(it.dataset.id); });\n$('#files').addEventListener('keydown', e => { if (e.key === 'Enter') { const it = e.target.closest('[data-id]'); if (it) openDrawer(it.dataset.id); } });\n\n// ---------- 檔案詳細資訊 ----------\nconst STORAGE_LABEL = { gdrive: 'Google 雲端硬碟', onedrive: 'OneDrive', dropbox: 'Dropbox' };\nfunction openDrawer(id) {\n  const f = state.all.filter(x => x.id === id)[0]; if (!f) return;\n  state.current = f;\n  const where = STORAGE_LABEL[f.storage] || f.storage;\n  $('#dTitle').textContent = f.category;\n  $('#dBody').innerHTML =\n    '<div class=\"preview\">' + thumbHtml(f) + '</div>' +\n    '<p class=\"d-name\">' + esc(f.name) + '</p>' +\n    '<div class=\"d-actions\">' +\n      '<a class=\"btn primary\" href=\"' + esc(f.url) + '\" target=\"_blank\" rel=\"noopener\">在 ' + esc(where) + ' 開啟 ↗</a>' +\n      '<button class=\"btn\" id=\"dRename\">重新命名</button><button class=\"btn danger\" id=\"dDelete\">刪除</button></div>' +\n    '<dl class=\"kv\">' +\n      '<dt>上傳者</dt><dd><a href=\"#\" id=\"dWho\">' + esc(f.uploader) + '</a></dd>' +\n      '<dt>來源</dt><dd>' + esc(f.source) + '</dd>' +\n      '<dt>上傳時間</dt><dd>' + fmtDate(f.uploadedAt) + '</dd>' +\n      '<dt>大小</dt><dd>' + fmtSize(f.size) + '</dd>' +\n      '<dt>存放位置</dt><dd>' + esc(where) + '<br><code>' + esc(f.path) + '</code></dd></dl>' +\n    '<div class=\"field\"><label for=\"dCat\">分類資料夾</label><select id=\"dCat\">' +\n      state.categories.map(c => '<option ' + (c.name === f.category ? 'selected' : '') + '>' + esc(c.name) + '</option>').join('') +\n    '</select><div class=\"hint\">變更分類會把檔案搬到對應的資料夾。</div></div>' +\n    '<div class=\"field\"><label for=\"dTagInput\">標籤</label><div class=\"tag-edit\" id=\"dTags\"></div><div class=\"hint\">輸入後按 Enter 新增；@ 開頭代表上傳者。</div></div>';\n  renderTagEditor();\n  $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false');\n  $('#dWho').onclick = e => { e.preventDefault(); state.tags = new Set(['@' + f.uploader]); state.category = ''; closeDrawer(); renderSidebar(); applyFilters(); };\n  $('#dCat').onchange = e => save({ category: e.target.value }, '已移到「' + e.target.value + '」');\n  $('#dDelete').onclick = async () => {\n    if (!confirm('確定要刪除「' + f.name + '」？' + (f.storage === 'gdrive' ? '檔案會移到 Google 雲端硬碟的垃圾桶。' : '檔案會從 ' + where + ' 刪除。'))) return;\n    try { await api('apiDeleteFile', f.id); closeDrawer(); toast('已刪除'); loadFiles(); } catch (e) { toast(e.message); }\n  };\n  $('#dRename').onclick = () => { const n = prompt('新的檔名', f.name); if (n && n.trim() && n !== f.name) save({ name: n.trim() }, '已重新命名'); };\n}\nfunction renderTagEditor() {\n  const f = state.current;\n  const fc = facets();\n  $('#dTags').innerHTML = f.tags.map((t, i) => '<span class=\"chip ' + (t[0] === '@' ? 'person' : '') + '\">' + esc(t) + '<button class=\"x\" data-i=\"' + i + '\" aria-label=\"移除標籤\">×</button></span>').join('') +\n    '<input id=\"dTagInput\" placeholder=\"新增標籤…\" list=\"tagSuggest\"><datalist id=\"tagSuggest\">' + fc.tags.concat(fc.uploaders).map(t => '<option value=\"' + esc(t.name) + '\">').join('') + '</datalist>';\n  $('#dTags').onclick = e => { const x = e.target.closest('.x'); if (x) save({ tags: f.tags.filter((_, i) => i !== +x.dataset.i) }); };\n  $('#dTagInput').onkeydown = e => {\n    if (e.key === 'Enter' && !e.isComposing) {\n      e.preventDefault();\n      const v = e.target.value.trim();\n      if (v && f.tags.indexOf(v) < 0) save({ tags: f.tags.concat([v]) }, '已新增標籤', true);\n    }\n  };\n}\nasync function save(patch, msg, refocus) {\n  try {\n    const u = await api('apiUpdateFile', state.current.id, patch);\n    const i = state.all.findIndex(x => x.id === u.id);\n    if (i >= 0) state.all[i] = u;\n    state.current = u;\n    if (patch.tags) renderTagEditor(); else openDrawer(u.id);\n    if (refocus) $('#dTagInput').focus();\n    if (msg) toast(msg);\n    renderSidebar(); applyFilters();\n  } catch (e) { toast(e.message); }\n}\nfunction closeDrawer() { $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); state.current = null; $('#dBody').innerHTML = ''; }\n$('#dClose').onclick = closeDrawer;\ndocument.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrawer(); closeSidebar(); } });\n\nlet qTimer;\n$('#q').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value.trim(); applyFilters(); }, 150); });\n$('#sort').addEventListener('change', e => { state.sort = e.target.value; applyFilters(); });\ndocument.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => { state.view = b.dataset.view; store.set('view', state.view); renderFiles(); }));\n$('#refreshBtn').onclick = () => loadFiles().then(() => toast('已更新'));\nconst closeSidebar = () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); };\n$('#menuBtn').onclick = () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); };\n$('#scrim').onclick = closeSidebar;\nsetInterval(() => { if (!document.hidden && currentTab === 'files' && !state.current && token) loadFiles(); }, 60000);\n\n// ================= 設定頁 =================\nconst ICONS = { doc: '文件', sheet: '試算表', slide: '簡報', image: '圖片', video: '影片', audio: '音訊', archive: '壓縮', design: '設計', code: '程式', file: '一般' };\nlet settings = null, activity = null, lineTest = null, rules = null;\n\nasync function loadSettings() {\n  try {\n    settings = await api('apiSettings');\n    rules = JSON.parse(JSON.stringify(settings.rules));\n    $('#webhookUrl').value = settings.webhookUrl;\n    $('#token').value = '';\n    $('#token').placeholder = settings.lineTokenSet ? '已設定（' + settings.lineTokenHint + '）— 留空表示不變更' : '貼上 Channel access token';\n    $('#replyOnSave').checked = settings.replyOnSave;\n    $('#rootFolder').value = settings.rootFolder;\n    renderStorage(); renderRules();\n    await loadActivity();\n    if (settings.lineTokenSet && !lineTest) testLine(true).catch(() => {});\n  } catch (e) { toast(e.message); }\n}\n\nfunction renderChecklist() {\n  if (!settings || !activity) return;\n  const groups = Object.keys(activity.groups || {}).map(k => activity.groups[k]);\n  const wh = lineTest && lineTest.webhook;\n  const whOk = wh ? wh.endpoint === settings.webhookUrl && wh.active : Boolean(activity.lastWebhookAt);\n  const steps = [\n    { done: true, title: '建立管理密碼' },\n    { done: settings.lineTokenSet, title: '填入 LINE 金鑰', body: '在 <a href=\"https://developers.line.biz/console/\" target=\"_blank\" rel=\"noopener\">LINE Developers</a> 建立 Messaging API channel，到 Messaging API 分頁最下方產生 Channel access token，貼到下方「LINE 連線」。' },\n    { done: lineTest && lineTest.ok, title: '金鑰測試成功', body: lineTest && !lineTest.ok ? '<span class=\"bad\">' + esc(lineTest.error) + '</span>' : '按下方「儲存並測試」。' },\n    { done: whOk, title: '在 LINE 後台設定 Webhook',\n      body: wh && wh.endpoint !== settings.webhookUrl ? 'LINE 後台目前填的是 <code>' + esc(wh.endpoint || '（空白）') + '</code>，請改成下方的 Webhook 網址（整串，包含 ?key=）。'\n        : wh && !wh.active ? '網址正確，但「Use webhook」還沒開啟。'\n        : 'Messaging API 分頁：貼上 Webhook 網址 → 開啟 Use webhook。同一頁把「Allow bot to join group chats」設為啟用，並到 LINE Official Account Manager 關閉「自動回應訊息」。（按 Verify 若顯示 302 錯誤可以忽略，看下方活動紀錄有沒有出現「驗證請求」即可）' },\n    { done: groups.length > 0, title: '把 Bot 邀請進群組', body: groups.length ? '' : '用手機掃 Bot 的 QR code 加好友，再從群組「邀請」把它加進去。' },\n    { done: activity.totalFiles > 0, title: '收到第一個檔案', body: '在群組傳一個檔案試試看，幾秒內就會出現在「檔案」頁。' },\n  ];\n  const all = steps.every(s => s.done);\n  $('#checklistCard').classList.toggle('collapsed', all);\n  $('#checklist').innerHTML = steps.map((s, i) => '<li class=\"' + (s.done ? 'done' : '') + '\"><span class=\"dot\">' + (s.done ? '✓' : i + 1) + '</span><div><b>' + s.title + '</b>' + (!s.done && s.body ? '<p>' + s.body + '</p>' : '') + '</div></li>').join('') +\n    (all ? '<li class=\"all-done\">🎉 全部完成！群組裡的檔案會自動存進雲端並出現在「檔案」頁。</li>' : '');\n}\n\n// ---------- LINE ----------\nasync function testLine(quiet) {\n  const box = $('#testResult');\n  if (!quiet) { box.hidden = false; box.className = 'test-result'; box.innerHTML = '<span class=\"spinner\"></span> 測試中…'; }\n  lineTest = await api('apiTestLine');\n  if (lineTest.ok) {\n    const b = lineTest.bot, wh = lineTest.webhook;\n    box.className = 'test-result ok';\n    box.innerHTML = (b.pictureUrl ? '<img src=\"' + esc(b.pictureUrl) + '\" alt=\"\">' : '') + '<div><b>✓ 已連上 ' + esc(b.name) + '</b> <span class=\"muted\">' + esc(b.basicId || '') + '</span><div class=\"muted\">' +\n      (wh ? (wh.endpoint === settings.webhookUrl ? (wh.active ? 'LINE 後台 Webhook 網址正確，且已啟用' : 'Webhook 網址正確，但尚未開啟 Use webhook') : 'LINE 後台的 Webhook 網址和這裡不同，請重新貼上') : '') + '</div></div>';\n  } else { box.className = 'test-result bad'; box.textContent = '✗ ' + lineTest.error; }\n  box.hidden = false;\n  renderChecklist();\n}\n$('#copyWebhook').onclick = () => copyText($('#webhookUrl').value, $('#webhookUrl'));\n$('#saveLine').onclick = async () => {\n  try {\n    const t = $('#token').value.trim();\n    if (t) { await api('apiSaveSettings', { lineToken: t }); toast('已儲存'); }\n    settings = await api('apiSettings');\n    $('#token').value = ''; $('#token').placeholder = settings.lineTokenSet ? '已設定（' + settings.lineTokenHint + '）— 留空表示不變更' : '貼上 Channel access token';\n    await testLine();\n  } catch (e) { toast(e.message); }\n};\n$('#testLine').onclick = () => testLine().catch(e => toast(e.message));\n$('#replyOnSave').onchange = e => api('apiSaveSettings', { replyOnSave: e.target.checked }).then(() => toast(e.target.checked ? '收到檔案時會在群組回覆' : '不會在群組回覆')).catch(err => toast(err.message));\n\n// ---------- 儲存位置 ----------\nconst STORAGE_META = {\n  gdrive: { logo: 'G', color: '#1a73e8', desc: '免設定，使用你部署這個程式的 Google 帳號。' },\n  onedrive: { logo: 'O', color: '#0364b8', desc: '個人或公司帳號皆可。需要先到 Azure 註冊應用程式（約 5 分鐘）。' },\n  dropbox: { logo: 'D', color: '#0061fe', desc: '需要先在 Dropbox App Console 建立 App（約 3 分鐘）。' },\n};\nfunction renderStorage() {\n  const cards = settings.storages.map(s => {\n    const m = STORAGE_META[s.id] || { logo: s.label[0], color: '#475569', desc: '' };\n    const active = settings.storage === s.id;\n    return '<div class=\"storage-card ' + (active ? 'active' : '') + '\">' + (active ? '<span class=\"s-badge\">使用中</span>' : '') +\n      '<div class=\"s-head\"><span class=\"s-logo\" style=\"background:' + m.color + '\">' + esc(m.logo) + '</span>' + esc(s.label) + '</div>' +\n      '<div class=\"s-state ' + (s.ready ? 'on' : '') + '\">' + (s.ready ? '✓ 已連接' + (s.account ? '：' + esc(s.account) : '') : '尚未連接') + '</div>' +\n      '<div class=\"muted\" style=\"font-size:12px\">' + m.desc + '</div>' +\n      '<div class=\"s-actions\">' +\n        (s.ready && !active ? '<button class=\"btn small primary\" data-use=\"' + s.id + '\">改用這個</button>' : '') +\n        (!s.ready ? '<button class=\"btn small primary\" data-connect=\"' + s.id + '\">連接</button>' : '') +\n        (s.ready && s.id !== 'gdrive' ? '<button class=\"btn small\" data-connect=\"' + s.id + '\">重新連接</button><button class=\"btn small ghost\" data-disconnect=\"' + s.id + '\">中斷</button>' : '') +\n      '</div></div>';\n  });\n  cards.push('<div class=\"storage-card disabled\"><div class=\"s-head\"><span class=\"s-logo\" style=\"background:#8e8e93\"></span>iCloud 雲碟</div>' +\n    '<div class=\"s-state\">無法連接</div><div class=\"muted\" style=\"font-size:12px\">Apple 沒有開放 iCloud 雲碟給第三方程式寫入。想在 iPhone 上看檔案，可以安裝 Google Drive 或 OneDrive App，它們會出現在 iPhone 的「檔案」App 裡，和 iCloud 放在一起。</div></div>');\n  $('#storageGrid').innerHTML = cards.join('');\n}\n$('#storageGrid').addEventListener('click', async e => {\n  const b = e.target.closest('button'); if (!b) return;\n  try {\n    if (b.dataset.use) { await api('apiUseStorage', b.dataset.use); toast('之後的檔案會存到 ' + STORAGE_LABEL[b.dataset.use]); }\n    else if (b.dataset.disconnect) { if (!confirm('確定要中斷連接？已存在那裡的檔案不會被刪除，但介面上無法再搬移或刪除它們。')) return; await api('apiDisconnectStorage', b.dataset.disconnect); toast('已中斷連接'); }\n    else if (b.dataset.connect) { showConnect(b.dataset.connect); return; }\n    settings = await api('apiSettings'); renderStorage();\n  } catch (err) { toast(err.message); }\n});\n\nlet pollTimer = null;\nfunction showConnect(id) {\n  clearInterval(pollTimer);\n  const p = $('#connectPanel');\n  if (id === 'onedrive') {\n    p.innerHTML = '<div class=\"connect-panel\"><h3>連接 OneDrive</h3><ol>' +\n      '<li>打開 <a href=\"https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade\" target=\"_blank\" rel=\"noopener\">Azure 應用程式註冊 ↗</a>（用你的 Microsoft 帳號登入），按「<b>新增註冊</b>」</li>' +\n      '<li>名稱隨意（例如 LINE 檔案櫃）；支援的帳戶類型選「<b>任何組織目錄中的帳戶及個人 Microsoft 帳戶</b>」；重新導向 URI 留空 → 註冊</li>' +\n      '<li>左側「<b>驗證</b>」→ 最下方「<b>允許公用用戶端流程</b>」選「是」→ 儲存</li>' +\n      '<li>回到「概觀」，複製「<b>應用程式 (用戶端) 識別碼</b>」貼到下面</li></ol>' +\n      '<label class=\"field\"><span>應用程式 (用戶端) 識別碼</span><input id=\"odClient\" placeholder=\"例如 1a2b3c4d-5e6f-…\" value=\"' + esc(settings.onedriveClientId) + '\"></label>' +\n      '<div class=\"row-actions\"><button class=\"btn primary\" id=\"odStart\">開始登入</button><button class=\"btn ghost\" id=\"cancelConnect\">取消</button></div><div id=\"odStep\"></div></div>';\n    $('#odStart').onclick = async () => {\n      const cid = $('#odClient').value.trim();\n      try {\n        const r = await api('apiOneDriveStart', cid);\n        $('#odStep').innerHTML = '<div class=\"device-code\"><span>到 <a href=\"' + esc(r.verificationUri) + '\" target=\"_blank\" rel=\"noopener\">' + esc(r.verificationUri) + ' ↗</a> 輸入代碼：</span><span class=\"code\">' + esc(r.userCode) + '</span><button class=\"btn small\" id=\"copyCode\">複製代碼</button></div><p class=\"muted\"><span class=\"spinner\"></span> 等待你在 Microsoft 頁面登入並按「接受」…</p>';\n        $('#copyCode').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(r.userCode).then(() => toast('已複製代碼'), () => {}); };\n        const until = Date.now() + (r.expiresIn || 900) * 1000;\n        pollTimer = setInterval(async () => {\n          if (Date.now() > until) { clearInterval(pollTimer); $('#odStep').innerHTML = '<p class=\"bad\">代碼已過期，請重新開始。</p>'; return; }\n          try {\n            const s = await api('apiOneDrivePoll', cid, r.deviceCode);\n            if (s.status === 'ok') { clearInterval(pollTimer); p.innerHTML = ''; toast('已連接 OneDrive'); settings = await api('apiSettings'); renderStorage(); }\n            else if (s.status === 'error') { clearInterval(pollTimer); $('#odStep').innerHTML = '<p class=\"bad\">' + esc(s.error) + '</p>'; }\n          } catch (err) { clearInterval(pollTimer); $('#odStep').innerHTML = '<p class=\"bad\">' + esc(err.message) + '</p>'; }\n        }, Math.max(5, r.interval) * 1000);\n      } catch (err) { toast(err.message); }\n    };\n  } else if (id === 'dropbox') {\n    p.innerHTML = '<div class=\"connect-panel\"><h3>連接 Dropbox</h3><ol>' +\n      '<li>打開 <a href=\"https://www.dropbox.com/developers/apps/create\" target=\"_blank\" rel=\"noopener\">Dropbox App Console ↗</a>：選「<b>Scoped access</b>」→「<b>App folder</b>」（只能存取自己的資料夾，比較安全）→ 名稱隨意 → Create app</li>' +\n      '<li>「<b>Permissions</b>」分頁勾選 <code>files.content.write</code>、<code>files.content.read</code>、<code>account_info.read</code> → 最下方 Submit</li>' +\n      '<li>回到「<b>Settings</b>」分頁，複製 <b>App key</b> 和 <b>App secret</b> 貼到下面</li></ol>' +\n      '<label class=\"field\"><span>App key</span><input id=\"dbxKey\" value=\"' + esc(settings.dropboxAppKey) + '\"></label>' +\n      '<label class=\"field\"><span>App secret</span><input id=\"dbxSecret\" type=\"password\"></label>' +\n      '<div class=\"row-actions\"><button class=\"btn\" id=\"dbxAuth\">① 取得授權碼 ↗</button></div>' +\n      '<label class=\"field\"><span>② 在 Dropbox 按「允許」後，把顯示的授權碼貼在這裡</span><input id=\"dbxCode\"></label>' +\n      '<div class=\"row-actions\"><button class=\"btn primary\" id=\"dbxConnect\">③ 連接</button><button class=\"btn ghost\" id=\"cancelConnect\">取消</button></div></div>';\n    $('#dbxAuth').onclick = async () => {\n      try { const url = await api('apiDropboxAuthUrl', $('#dbxKey').value); window.open(url, '_blank', 'noopener'); }\n      catch (err) { toast(err.message); }\n    };\n    $('#dbxConnect').onclick = async () => {\n      try {\n        await api('apiDropboxConnect', $('#dbxKey').value, $('#dbxSecret').value, $('#dbxCode').value);\n        p.innerHTML = ''; toast('已連接 Dropbox'); settings = await api('apiSettings'); renderStorage();\n      } catch (err) { toast(err.message); }\n    };\n  }\n  const c = $('#cancelConnect'); if (c) c.onclick = () => { clearInterval(pollTimer); p.innerHTML = ''; };\n  p.scrollIntoView({ behavior: 'smooth', block: 'nearest' });\n}\n$('#saveRoot').onclick = () => api('apiSaveSettings', { rootFolder: $('#rootFolder').value }).then(() => toast('已儲存')).catch(e => toast(e.message));\n\n// ---------- 分類規則 ----------\nfunction iconSelect(v) { return '<select data-k=\"icon\">' + Object.keys(ICONS).map(k => '<option value=\"' + k + '\" ' + (k === v ? 'selected' : '') + '>' + ICONS[k] + '</option>').join('') + '</select>'; }\nfunction renderRules() {\n  $('#catTable').innerHTML = '<div class=\"rt-head cat\"><span>分類（資料夾）名稱</span><span>圖示</span><span>副檔名</span><span></span></div>' +\n    rules.categories.map((c, i) => '<div class=\"rt-row cat\" data-i=\"' + i + '\"><input data-k=\"name\" value=\"' + esc(c.name) + '\" maxlength=\"30\" aria-label=\"分類名稱\">' + iconSelect(c.icon) +\n      '<input data-k=\"exts\" value=\"' + esc([].concat(c.exts).join(', ')) + '\" aria-label=\"副檔名\"><button class=\"icon-btn\" data-del title=\"刪除\">✕</button></div>').join('');\n  $('#kwTable').innerHTML = '<div class=\"rt-head kw\"><span>關鍵字</span><span>加上標籤</span><span>子資料夾（可空白）</span><span></span></div>' +\n    rules.keywordRules.map((k, i) => '<div class=\"rt-row kw\" data-i=\"' + i + '\"><input data-k=\"keywords\" value=\"' + esc([].concat(k.keywords).join(', ')) + '\" aria-label=\"關鍵字\">' +\n      '<input data-k=\"tag\" value=\"' + esc(k.tag || '') + '\" maxlength=\"30\" aria-label=\"標籤\"><input data-k=\"folder\" value=\"' + esc(k.folder || '') + '\" maxlength=\"30\" aria-label=\"子資料夾\">' +\n      '<button class=\"icon-btn\" data-del title=\"刪除\">✕</button></div>').join('');\n  $('#fallbackName').value = (rules.fallbackCategory && rules.fallbackCategory.name) || '其他';\n}\nfunction bindTable(sel, key) {\n  $(sel).addEventListener('input', e => { const r = e.target.closest('[data-i]'); if (r && e.target.dataset.k) rules[key][r.dataset.i][e.target.dataset.k] = e.target.value; });\n  $(sel).addEventListener('click', e => { const r = e.target.closest('[data-i]'); if (r && e.target.closest('[data-del]')) { rules[key].splice(+r.dataset.i, 1); renderRules(); } });\n}\nbindTable('#catTable', 'categories');\nbindTable('#kwTable', 'keywordRules');\n$('#addCat').onclick = () => { rules.categories.push({ name: '', icon: 'file', exts: [] }); renderRules(); };\n$('#addKw').onclick = () => { rules.keywordRules.push({ keywords: [], tag: '', folder: '' }); renderRules(); };\n$('#fallbackName').oninput = e => { rules.fallbackCategory = { name: e.target.value, icon: 'file' }; };\nasync function saveRules() { await api('apiSaveSettings', { rules: rules }); settings = await api('apiSettings'); rules = JSON.parse(JSON.stringify(settings.rules)); renderRules(); }\n$('#saveRules').onclick = () => saveRules().then(() => toast('規則已儲存，之後收到的檔案會套用新規則')).catch(e => toast(e.message));\n$('#resetRules').onclick = async () => {\n  if (!confirm('確定要還原成預設的分類規則？')) return;\n  try { await api('apiSaveSettings', { rules: null }); settings = await api('apiSettings'); rules = JSON.parse(JSON.stringify(settings.rules)); renderRules(); toast('已還原預設規則'); } catch (e) { toast(e.message); }\n};\n$('#reclassify').onclick = async () => {\n  if (!confirm('會先儲存目前的規則，再把所有現有檔案依規則重新搬到對應資料夾。\\n\\n・手動加的標籤會保留\\n・之前手動改過分類的檔案，也會被改回規則判斷的分類\\n・檔案多的話需要一點時間\\n\\n要繼續嗎？')) return;\n  try { await saveRules(); toast('整理中…'); const r = await api('apiReclassify'); toast('完成，搬移了 ' + r.moved + ' 個檔案' + (r.failed ? '，' + r.failed + ' 個失敗（見活動紀錄）' : '')); state.all = []; loadActivity(); }\n  catch (e) { toast(e.message); }\n};\n\n// ---------- 密碼、活動紀錄 ----------\n$('#pwForm').addEventListener('submit', async e => {\n  e.preventDefault();\n  try { token = await api('apiChangePassword', $('#pwCur').value, $('#pwNew').value); store.set('lfb_token', token); e.target.reset(); toast('密碼已變更，其他裝置需要重新登入'); }\n  catch (err) { toast(err.message); }\n});\nasync function loadActivity() {\n  activity = await api('apiActivity');\n  $('#statusLine').textContent = activity.lastWebhookAt ? '最後收到 LINE 訊息：' + fmtTime(activity.lastWebhookAt) : '尚未收到任何 LINE 訊息';\n  $('#activity').innerHTML = activity.entries.map(e => '<li class=\"lv-' + esc(e.level) + '\"><time>' + fmtTime(e.at) + '</time><span>' + esc(e.msg) + '</span></li>').join('') || '<li class=\"muted\">還沒有紀錄。</li>';\n  renderChecklist();\n}\nsetInterval(() => { if (!document.hidden && currentTab === 'settings' && token) loadActivity().catch(() => {}); }, 10000);\n\n// ================= 啟動 =================\n(async () => {\n  try {\n    const s = await call('apiSession', token);\n    if (s.loggedIn) startApp(location.hash === '#settings' ? 'settings' : 'files'); else showAuth();\n  } catch (e) { showAuth(); }\n})();\n\n</script>\n</body>\n</html>\n";

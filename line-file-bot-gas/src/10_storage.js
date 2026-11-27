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

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

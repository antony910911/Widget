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

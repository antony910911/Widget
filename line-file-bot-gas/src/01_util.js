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

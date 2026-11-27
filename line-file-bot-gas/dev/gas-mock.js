// 在 Node 裡模擬 Google Apps Script 用到的服務，用來測試與本機預覽。
// 只實作本專案用到的部分。
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Blob {
  constructor(bytes, type, name) { this.bytes = Buffer.from(bytes || []); this.type = type || ''; this.name = name || ''; }
  getBytes() { return Array.from(this.bytes); }
  getContentType() { return this.type; }
  setContentType(t) { this.type = t; return this; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getDataAsString() { return this.bytes.toString('utf8'); }
}
const iter = arr => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
const unquote = v => (typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v);

function createGas({ fetch: fetchHandler, webAppUrl = 'https://script.google.com/macros/s/TEST/exec' } = {}) {
  let idSeq = 0;
  const nid = p => p + (++idSeq).toString(36).padStart(6, '0');

  // ---------- Drive ----------
  const drive = { folders: new Map(), files: new Map() };
  class Folder {
    constructor(name, parent) { this.id = nid('fo'); this.name = name; this.parent = parent; this.trashed = false; drive.folders.set(this.id, this); }
    getId() { return this.id; } getName() { return this.name; } setName(n) { this.name = n; return this; }
    isTrashed() { return this.trashed; } getUrl() { return 'https://drive.google.com/drive/folders/' + this.id; }
    getFoldersByName(n) { return iter([...drive.folders.values()].filter(f => f.parent === this && f.name === n && !f.trashed)); }
    getFilesByName(n) { return iter([...drive.files.values()].filter(f => f.parent === this && f.name === n && !f.trashed)); }
    createFolder(n) { return new Folder(n, this); }
    createFile(blob) { return new File(blob, this); }
    pathStr() { return (this.parent ? this.parent.pathStr() + '/' : '') + this.name; }
  }
  class File {
    constructor(blob, parent) { this.id = nid('fi'); this.blob = blob; this.name = blob.getName(); this.parent = parent; this.trashed = false; drive.files.set(this.id, this); }
    getId() { return this.id; } getName() { return this.name; } setName(n) { this.name = n; return this; }
    moveTo(f) { this.parent = f; return this; } setTrashed(t) { this.trashed = t; return this; } isTrashed() { return this.trashed; }
    getUrl() { return 'https://drive.google.com/file/d/' + this.id + '/view'; }
    getThumbnail() { return /^image\//.test(this.blob.type) ? new Blob(this.blob.bytes, this.blob.type) : null; }
    getBlob() { return this.blob; }
    pathStr() { return this.parent.pathStr() + '/' + this.name; }
  }
  const myDrive = new Folder('我的雲端硬碟', null);
  const DriveApp = {
    createFolder: n => myDrive.createFolder(n),
    getRootFolder: () => myDrive,
    getFolderById(id) { const f = drive.folders.get(id); if (!f) throw new Error('Folder not found'); return f; },
    getFileById(id) {
      const f = drive.files.get(id) || drive.sheetFiles?.get(id);
      if (!f) throw new Error('File not found: ' + id);
      return f;
    },
  };

  // ---------- Sheets ----------
  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = this.sh.rows[this.r - 1 + i] || [];
        out.push(Array.from({ length: this.nc }, (_, j) => (row[this.c - 1 + j] === undefined ? '' : row[this.c - 1 + j])));
      }
      return out;
    }
    setValues(vals) {
      vals.forEach((v, i) => {
        const row = this.sh.rows[this.r - 1 + i] || (this.sh.rows[this.r - 1 + i] = []);
        v.forEach((x, j) => { row[this.c - 1 + j] = unquote(x); });
      });
      return this;
    }
    setFontWeight() { return this; } setNumberFormat() { return this; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; }
    getName() { return this.name; } setName(n) { this.name = n; return this; }
    appendRow(r) { this.rows.push(r.map(unquote)); return this; }
    getLastRow() { return this.rows.length; }
    getDataRange() { return new Range(this, 1, 1, Math.max(1, this.rows.length), Math.max(1, ...this.rows.map(r => r.length))); }
    getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
    deleteRow(r) { this.rows.splice(r - 1, 1); }
    deleteRows(r, n) { this.rows.splice(r - 1, n); }
    insertRowAfter(r) { this.rows.splice(r, 0, []); }
    setFrozenRows() {}
  }
  const sheets = new Map();
  drive.sheetFiles = new Map();
  class Spreadsheet {
    constructor(name) {
      this.id = nid('ss'); this.name = name; this.sheets = [new Sheet('工作表1')]; sheets.set(this.id, this);
      const f = { id: this.id, name, parent: myDrive, getId: () => this.id, moveTo(p) { this.parent = p; } };
      drive.sheetFiles.set(this.id, f);
    }
    getId() { return this.id; } getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
    getSheets() { return this.sheets; }
    getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
    insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  }
  const SpreadsheetApp = {
    create: n => new Spreadsheet(n),
    openById(id) { const s = sheets.get(id); if (!s) throw new Error('not found'); return s; },
  };

  // ---------- Properties / Cache / Lock ----------
  const props = {};
  const PropertiesService = { getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; },
    getProperties: () => ({ ...props }),
  }) };
  const cacheData = new Map();
  const cache = {
    get(k) { const e = cacheData.get(k); return e && e.exp > Date.now() ? e.v : null; },
    put(k, v, s = 600) { cacheData.set(k, { v: String(v), exp: Date.now() + s * 1000 }); },
    remove(k) { cacheData.delete(k); },
    getAll(keys) { const o = {}; keys.forEach(k => { const v = cache.get(k); if (v != null) o[k] = v; }); return o; },
  };
  const CacheService = { getScriptCache: () => cache };
  const LockService = { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) };

  // ---------- UrlFetch ----------
  const requests = [];
  const UrlFetchApp = {
    fetch(url, opts = {}) {
      requests.push({ url, opts });
      const r = fetchHandler ? fetchHandler(url, opts) : null;
      if (!r) throw new Error('No mock for ' + url);
      const body = Buffer.isBuffer(r.body) ? r.body : Buffer.from(typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? ''));
      const headers = r.headers || { 'Content-Type': typeof r.body === 'object' && !Buffer.isBuffer(r.body) ? 'application/json' : 'text/plain' };
      if (!opts.muteHttpExceptions && (r.code || 200) >= 400) throw new Error('Request failed ' + r.code);
      return {
        getResponseCode: () => r.code || 200, getContentText: () => body.toString('utf8'), getHeaders: () => headers,
        getBlob: () => new Blob(body, headers['Content-Type'] || ''),
      };
    },
  };

  // ---------- Utilities 等 ----------
  const Utilities = {
    getUuid: () => crypto.randomUUID(),
    base64Encode: d => Buffer.from(typeof d === 'string' ? d : Uint8Array.from(d.map(b => b & 255))).toString('base64'),
    computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s).digest()).map(b => (b > 127 ? b - 256 : b)),
    DigestAlgorithm: { SHA_256: 'sha256' },
    newBlob: (d, t, n) => new Blob(typeof d === 'string' ? Buffer.from(d) : d, t, n),
    sleep() {},
    formatDate(date, tz, fmt) {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
        .formatToParts(date).map(x => [x.type, x.value]));
      return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour === '24' ? '00' : p.hour).replace('mm', p.minute).replace('ss', p.second);
    },
  };
  const Session = { getScriptTimeZone: () => 'Asia/Taipei', getEffectiveUser: () => ({ getEmail: () => 'me@gmail.com' }) };
  const ScriptApp = { getService: () => ({ getUrl: () => webAppUrl }) };
  const ContentService = { createTextOutput: s => ({ content: s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } };
  const htmlOut = o => Object.assign(o, { setTitle() { return this; }, addMetaTag() { return this; } });
  const HtmlService = { createHtmlOutputFromFile: n => htmlOut({ file: n }), createHtmlOutput: h => htmlOut({ html: h }) };

  const context = vm.createContext({
    DriveApp, SpreadsheetApp, PropertiesService, CacheService, LockService, UrlFetchApp, Utilities, Session, ScriptApp,
    ContentService, HtmlService, console: { log() {} }, Date, JSON, Math, Object, Array, String, Number, Boolean, Error, Buffer,
  });
  const code = fs.readFileSync(path.join(__dirname, '..', 'dist', 'Code.gs'), 'utf8');
  // 跟 Apps Script 一樣：每次請求都重新執行最上層程式碼（這裡只執行一次就好）
  vm.runInContext(code, context, { filename: 'Code.gs' });

  return {
    context, drive, props, requests, cacheData, Blob, myDrive,
    call: (fn, ...args) => {
      if (typeof context[fn] !== 'function' || fn.endsWith('_')) throw new Error('google.script.run 不能呼叫 ' + fn);
      return JSON.parse(JSON.stringify(context[fn](...args) ?? null));
    },
    doPost: (key, body) => context.doPost({ parameter: key ? { key } : {}, postData: { contents: JSON.stringify(body) } }),
    sheet: name => sheets.values().next().value?.getSheetByName(name),
    code,
  };
}

module.exports = { createGas, Blob };

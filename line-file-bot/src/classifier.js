import fs from 'node:fs';
import path from 'node:path';

const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/heic': 'heic', 'video/mp4': 'mp4', 'video/quicktime': 'mov',
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mpeg': 'mp3', 'audio/aac': 'aac',
  'application/pdf': 'pdf',
};

export function extFromMime(mime, fallback = 'bin') {
  if (!mime) return fallback;
  return MIME_EXT[mime.split(';')[0].trim().toLowerCase()] || fallback;
}

export function getExt(filename) {
  const ext = path.extname(filename || '').slice(1).toLowerCase();
  return ext;
}

/** 移除不能當檔名的字元，避免路徑穿越 */
export function sanitizeFilename(name) {
  let s = String(name || '').normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '_')
    .trim();
  if (!s) s = 'file';
  // 限制長度（保留副檔名）
  if (Buffer.byteLength(s) > 200) {
    const ext = path.extname(s);
    let base = s.slice(0, s.length - ext.length);
    while (Buffer.byteLength(base + ext) > 200) base = base.slice(0, -1);
    s = base + ext;
  }
  return s;
}

export function sanitizeFolder(name) {
  return sanitizeFilename(name).replace(/\.+$/, '') || '未命名';
}

export class Classifier {
  constructor(rulesPath) {
    this.rulesPath = rulesPath;
    this.reload();
  }

  reload() {
    const rules = JSON.parse(fs.readFileSync(this.rulesPath, 'utf8'));
    this.categories = rules.categories || [];
    this.fallback = rules.fallbackCategory || { name: '其他', icon: 'file' };
    this.keywordRules = rules.keywordRules || [];
    this.extMap = new Map();
    for (const c of this.categories) for (const e of c.exts) this.extMap.set(e.toLowerCase(), c);
  }

  categoryList() {
    return [...this.categories, this.fallback].map(c => ({ name: c.name, icon: c.icon }));
  }

  iconFor(categoryName) {
    return this.categoryList().find(c => c.name === categoryName)?.icon || 'file';
  }

  /**
   * @param {string} filename
   * @param {string} [lineType] LINE message type: file|image|video|audio
   * @returns {{category:string, icon:string, folder:string, tags:string[]}}
   */
  classify(filename, lineType) {
    const ext = getExt(filename);
    let cat = this.extMap.get(ext);
    if (!cat) {
      const byType = { image: '圖片', video: '影片', audio: '音訊' }[lineType];
      cat = this.categories.find(c => c.name === byType) || this.fallback;
    }
    const lower = (filename || '').toLowerCase();
    const tags = [];
    let sub = null;
    for (const r of this.keywordRules) {
      if (r.keywords.some(k => lower.includes(String(k).toLowerCase()))) {
        if (r.tag && !tags.includes(r.tag)) tags.push(r.tag);
        if (!sub && r.folder) sub = r.folder;
      }
    }
    const folder = sub ? path.posix.join(sanitizeFolder(cat.name), sanitizeFolder(sub)) : sanitizeFolder(cat.name);
    return { category: cat.name, icon: cat.icon, folder, tags };
  }
}

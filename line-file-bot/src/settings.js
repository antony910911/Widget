import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * 可以在網頁上修改的設定（LINE 金鑰、密碼、分類規則…），存在 data/settings.json。
 * 環境變數只當作初始值 / 後備值。
 */
export class Settings {
  constructor(dataDir, { env = {}, defaultRulesPath }) {
    this.file = path.join(dataDir, 'settings.json');
    this.env = env;
    this.defaultRulesPath = defaultRulesPath;
    fs.mkdirSync(dataDir, { recursive: true });
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
    if (!this.data.sessionSecret) {
      this.data.sessionSecret = crypto.randomBytes(32).toString('hex');
      this.saveSync();
    }
  }

  saveSync() {
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 1), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
  }
  async save() {
    await fsp.writeFile(this.file + '.tmp', JSON.stringify(this.data, null, 1), { mode: 0o600 });
    await fsp.rename(this.file + '.tmp', this.file);
  }

  get channelSecret() { return this.data.channelSecret ?? this.env.channelSecret ?? ''; }
  get accessToken() { return this.data.accessToken ?? this.env.accessToken ?? ''; }
  get replyOnSave() { return this.data.replyOnSave ?? this.env.replyOnSave ?? false; }
  get sessionSecret() { return this.data.sessionSecret; }

  defaultRules() { return JSON.parse(fs.readFileSync(this.defaultRulesPath, 'utf8')); }
  get rules() { return this.data.rules || this.defaultRules(); }

  // ----- 密碼 -----
  get passwordConfigured() { return Boolean(this.data.passwordHash || this.env.adminPassword); }
  /** 用來簽 session 的金鑰，改密碼後舊的登入會失效 */
  get sessionKey() { return this.sessionSecret + (this.data.passwordHash || this.env.adminPassword || ''); }

  checkPassword(pw) {
    pw = String(pw || '');
    if (this.data.passwordHash) {
      const [salt, hash] = this.data.passwordHash.split(':');
      const got = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 32);
      return crypto.timingSafeEqual(got, Buffer.from(hash, 'hex'));
    }
    if (this.env.adminPassword) {
      const a = crypto.createHash('sha256').update(pw).digest();
      const b = crypto.createHash('sha256').update(this.env.adminPassword).digest();
      return crypto.timingSafeEqual(a, b);
    }
    return false;
  }

  async setPassword(pw) {
    const salt = crypto.randomBytes(16);
    this.data.passwordHash = salt.toString('hex') + ':' + crypto.scryptSync(String(pw), salt, 32).toString('hex');
    await this.save();
  }

  async update(patch) {
    for (const k of ['channelSecret', 'accessToken']) {
      if (typeof patch[k] === 'string') this.data[k] = patch[k].trim();
    }
    if (typeof patch.replyOnSave === 'boolean') this.data.replyOnSave = patch.replyOnSave;
    if (patch.rules === null) delete this.data.rules; // 還原預設
    else if (patch.rules) this.data.rules = validateRules(patch.rules);
    await this.save();
  }
}

const ICONS = ['doc', 'sheet', 'slide', 'image', 'video', 'audio', 'archive', 'design', 'code', 'file'];
const clean = (s, max = 40) => String(s ?? '').trim().slice(0, max);
const list = (v, max = 40) => (Array.isArray(v) ? v : String(v ?? '').split(/[,，、\s]+/)).map(x => clean(x, max)).filter(Boolean);

export function validateRules(r) {
  const seen = new Set();
  const categories = (r.categories || []).map(c => ({
    name: clean(c.name, 30).replace(/[\\/:*?"<>|]/g, ''),
    icon: ICONS.includes(c.icon) ? c.icon : 'file',
    exts: [...new Set(list(c.exts, 12).map(e => e.replace(/^\./, '').toLowerCase()))],
  })).filter(c => c.name && !seen.has(c.name) && seen.add(c.name));
  if (!categories.length) throw new Error('至少要有一個分類');
  const fbName = clean(r.fallbackCategory?.name, 30).replace(/[\\/:*?"<>|]/g, '') || '其他';
  if (seen.has(fbName)) throw new Error(`「${fbName}」不能同時是一般分類和未分類的預設資料夾`);
  const keywordRules = (r.keywordRules || []).map(k => ({
    keywords: list(k.keywords),
    tag: clean(k.tag, 30),
    ...(clean(k.folder) ? { folder: clean(k.folder, 30).replace(/[\\/:*?"<>|]/g, '') } : {}),
  })).filter(k => k.keywords.length && (k.tag || k.folder));
  return { categories, fallbackCategory: { name: fbName, icon: 'file' }, keywordRules };
}

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * 很小的 JSON 檔案資料庫。個人 / 小團隊用量（數萬筆以內）綽綽有餘，且不需要安裝任何原生套件。
 */
export class Store {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'db.json');
    fs.mkdirSync(dataDir, { recursive: true });
    this.data = { files: [], cache: { names: {} } };
    if (fs.existsSync(this.file)) {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    }
    this._saving = Promise.resolve();
  }

  save() {
    // 序列化寫入：先寫暫存檔再 rename，避免寫到一半斷電造成檔案損毀
    this._saving = this._saving.then(async () => {
      const tmp = this.file + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(this.data, null, 1));
      await fsp.rename(tmp, this.file);
    });
    return this._saving;
  }

  all() { return this.data.files; }
  get(id) { return this.data.files.find(f => f.id === id); }
  findByMessageId(mid) { return this.data.files.find(f => f.messageId === mid); }

  async add(rec) {
    const full = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...rec };
    this.data.files.push(full);
    await this.save();
    return full;
  }

  async update(id, patch) {
    const f = this.get(id);
    if (!f) return null;
    Object.assign(f, patch, { updatedAt: new Date().toISOString() });
    await this.save();
    return f;
  }

  async remove(id) {
    const i = this.data.files.findIndex(f => f.id === id);
    if (i < 0) return null;
    const [f] = this.data.files.splice(i, 1);
    await this.save();
    return f;
  }

  // 顯示名稱快取（群組名、成員名），減少呼叫 LINE API
  getCachedName(key) {
    const c = this.data.cache.names[key];
    if (c && Date.now() - c.at < 24 * 3600 * 1000) return c.name;
    return null;
  }
  setCachedName(key, name) {
    this.data.cache.names[key] = { name, at: Date.now() };
  }
}

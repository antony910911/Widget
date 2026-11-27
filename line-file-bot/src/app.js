import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifySignature, createLineClient } from './line.js';
import { Store } from './store.js';
import { Classifier, sanitizeFilename, getExt } from './classifier.js';
import { handleEvent, uploaderTag } from './ingest.js';
import { resolveInside, placeFile, moveFile, uniqueName, removeEmptyParents } from './files.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    channelSecret: env.LINE_CHANNEL_SECRET || '',
    accessToken: env.LINE_CHANNEL_ACCESS_TOKEN || '',
    adminPassword: env.ADMIN_PASSWORD || '',
    storageDir: path.resolve(env.STORAGE_DIR || path.join(ROOT, 'storage')),
    dataDir: path.resolve(env.DATA_DIR || path.join(ROOT, 'data')),
    rulesPath: path.resolve(env.RULES_PATH || path.join(ROOT, 'config', 'rules.json')),
    replyOnSave: /^(1|true|yes)$/i.test(env.REPLY_ON_SAVE || ''),
    lineApiBase: env.LINE_API_BASE || 'https://api.line.me',
    lineDataBase: env.LINE_DATA_API_BASE || 'https://api-data.line.me',
  };
}

function basicAuth(password) {
  return (req, res, next) => {
    if (!password) return next();
    const [type, b64] = (req.headers.authorization || '').split(' ');
    if (type === 'Basic' && b64) {
      const [, pass] = Buffer.from(b64, 'base64').toString().split(/:(.*)/s);
      const a = crypto.createHash('sha256').update(pass || '').digest();
      const b = crypto.createHash('sha256').update(password).digest();
      if (crypto.timingSafeEqual(a, b)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="LINE File Bot", charset="UTF-8"').status(401).send('需要登入');
  };
}

const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createApp(config = loadConfig(), deps = {}) {
  fs.mkdirSync(config.storageDir, { recursive: true });
  const store = deps.store || new Store(config.dataDir);
  const classifier = deps.classifier || new Classifier(config.rulesPath);
  const line = deps.line || createLineClient({ token: config.accessToken, apiBase: config.lineApiBase, dataBase: config.lineDataBase });
  const log = deps.log || console;
  const ctx = { line, store, classifier, config, log };
  const pending = new Set();

  const app = express();
  app.disable('x-powered-by');

  // ---------- LINE webhook（不經過密碼驗證，靠簽章驗證）----------
  app.post('/webhook', express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
    if (!verifySignature(req.body, req.get('x-line-signature'), config.channelSecret)) {
      return res.status(401).send('bad signature');
    }
    let body;
    try { body = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).send('bad json'); }
    res.status(200).send('ok'); // 先回 200，LINE 要求快速回應
    for (const ev of body.events || []) {
      const p = handleEvent(ev, ctx)
        .catch(e => log.error?.('處理事件失敗：', e.message))
        .finally(() => pending.delete(p));
      pending.add(p);
    }
  });

  // ---------- 管理介面 ----------
  app.use(basicAuth(config.adminPassword));
  app.use(express.json());
  app.use(express.static(path.join(ROOT, 'public')));

  const view = f => ({ ...f, icon: classifier.iconFor(f.category) });

  app.get('/api/files', (req, res) => {
    const { q = '', category = '', sort = 'newest' } = req.query;
    const tags = [].concat(req.query.tag || []).filter(Boolean);
    const needle = String(q).toLowerCase();
    let list = store.all().filter(f =>
      (!category || f.category === category) &&
      tags.every(t => f.tags.includes(t)) &&
      (!needle || [f.originalName, f.uploader?.name, f.source?.name, ...f.tags].join(' ').toLowerCase().includes(needle)));
    const cmp = {
      newest: (a, b) => b.uploadedAt.localeCompare(a.uploadedAt),
      oldest: (a, b) => a.uploadedAt.localeCompare(b.uploadedAt),
      name: (a, b) => a.originalName.localeCompare(b.originalName, 'zh-Hant'),
      size: (a, b) => b.size - a.size,
    }[sort] || (() => 0);
    list = [...list].sort(cmp);
    res.json({ files: list.map(view), total: list.length });
  });

  app.get('/api/facets', (req, res) => {
    const files = store.all();
    const tagCount = new Map(), catCount = new Map();
    for (const f of files) {
      catCount.set(f.category, (catCount.get(f.category) || 0) + 1);
      for (const t of f.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    }
    const tags = [...tagCount].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    res.json({
      total: files.length,
      totalSize: files.reduce((s, f) => s + (f.size || 0), 0),
      categories: classifier.categoryList().map(c => ({ ...c, count: catCount.get(c.name) || 0 })),
      uploaders: tags.filter(t => t.name.startsWith('@')),
      groups: tags.filter(t => t.name.startsWith('群:')),
      tags: tags.filter(t => !t.name.startsWith('@') && !t.name.startsWith('群:') && !catCount.has(t.name)),
    });
  });

  app.get('/api/files/:id', (req, res) => {
    const f = store.get(req.params.id);
    f ? res.json(view(f)) : res.status(404).json({ error: '找不到檔案' });
  });

  function sendFile(req, res, inline) {
    const f = store.get(req.params.id);
    if (!f) return res.status(404).send('找不到檔案');
    const abs = resolveInside(config.storageDir, f.path);
    if (!fs.existsSync(abs)) return res.status(410).send('檔案已不存在於磁碟');
    if (inline) {
      // 防止上傳的 HTML/SVG 在本站執行腳本（PDF 交給瀏覽器內建檢視器，不能加 sandbox）
      if (f.ext !== 'pdf') res.set('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
      res.set('X-Content-Type-Options', 'nosniff');
      return res.sendFile(abs, { headers: { 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.storedName)}` } });
    }
    res.download(abs, f.storedName);
  }
  app.get('/api/files/:id/download', (req, res) => sendFile(req, res, false));
  app.get('/api/files/:id/raw', (req, res) => sendFile(req, res, true));

  // 修改標籤 / 分類 / 檔名
  app.patch('/api/files/:id', h(async (req, res) => {
    const f = store.get(req.params.id);
    if (!f) return res.status(404).json({ error: '找不到檔案' });
    const patch = {};
    if (Array.isArray(req.body.tags)) {
      patch.tags = [...new Set(req.body.tags.map(t => String(t).trim()).filter(Boolean))].slice(0, 50);
    }
    const newCat = req.body.category;
    const newName = req.body.name ? sanitizeFilename(req.body.name) : null;
    if ((newCat && newCat !== f.category) || (newName && newName !== f.storedName)) {
      if (newCat && !classifier.categoryList().some(c => c.name === newCat)) return res.status(400).json({ error: '沒有這個分類' });
      const cat = newCat || f.category;
      // 換分類時，子資料夾（例如 報價單）一起保留
      const sub = f.folder.split('/').slice(1).join('/');
      const folder = newCat && newCat !== f.category ? (sub ? `${cat}/${sub}` : cat) : f.folder;
      const dir = resolveInside(config.storageDir, folder);
      await fsp.mkdir(dir, { recursive: true });
      const from = resolveInside(config.storageDir, f.path);
      const finalName = uniqueName(dir, newName || f.storedName);
      await moveFile(from, path.join(dir, finalName));
      await removeEmptyParents(config.storageDir, path.dirname(from));
      Object.assign(patch, {
        category: cat, folder, storedName: finalName, path: `${folder}/${finalName}`,
        ...(newName ? { originalName: newName, ext: getExt(newName) } : {}),
      });
      // 標籤裡的舊分類換成新分類
      const t = patch.tags || [...f.tags];
      if (newCat && newCat !== f.category) {
        const i = t.indexOf(f.category);
        if (i >= 0) t[i] = cat; else t.push(cat);
        patch.tags = [...new Set(t)];
      }
    }
    res.json(view(await store.update(f.id, patch)));
  }));

  app.delete('/api/files/:id', h(async (req, res) => {
    const f = store.get(req.params.id);
    if (!f) return res.status(404).json({ error: '找不到檔案' });
    const abs = resolveInside(config.storageDir, f.path);
    await fsp.rm(abs, { force: true });
    await removeEmptyParents(config.storageDir, path.dirname(abs));
    await store.remove(f.id);
    res.json({ ok: true });
  }));

  // 從介面手動上傳（不經過 LINE）
  app.post('/api/upload', express.raw({ type: '*/*', limit: '200mb' }), h(async (req, res) => {
    const name = sanitizeFilename(decodeURIComponent(req.get('x-filename') || 'file'));
    const uploader = String(req.get('x-uploader') ? decodeURIComponent(req.get('x-uploader')) : '我').slice(0, 50);
    const tmpDir = path.join(config.storageDir, '.tmp');
    await fsp.mkdir(tmpDir, { recursive: true });
    const tmp = path.join(tmpDir, crypto.randomUUID());
    await fsp.writeFile(tmp, req.body);
    const cls = classifier.classify(name);
    const { relPath, storedName } = await placeFile(config.storageDir, tmp, cls.folder, name);
    const rec = await store.add({
      messageId: null, lineType: 'manual', originalName: name, storedName, path: relPath, folder: cls.folder,
      ext: getExt(name), mime: req.get('content-type') || '', size: req.body.length, category: cls.category,
      uploader: { id: null, name: uploader }, source: { type: 'manual', id: null, name: '手動上傳' },
      tags: [...new Set([uploaderTag(uploader), cls.category, ...cls.tags])], uploadedAt: new Date().toISOString(),
    });
    res.json(view(rec));
  }));

  app.use((err, req, res, next) => {
    log.error?.(err);
    res.status(500).json({ error: err.message || '伺服器錯誤' });
  });

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  app.locals.ctx = ctx;
  app.locals.idle = () => Promise.all([...pending]);
  return app;
}

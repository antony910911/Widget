import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import yazl from 'yazl';
import { verifySignature, createLineClient } from './line.js';
import { Store } from './store.js';
import { Classifier, sanitizeFilename, getExt } from './classifier.js';
import { handleEvent, uploaderTag } from './ingest.js';
import { resolveInside, placeFile, moveFile, uniqueName, removeEmptyParents } from './files.js';
import { Settings } from './settings.js';
import { isLoggedIn, setSession, clearSession, createLoginLimiter } from './auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    host: env.HOST || undefined,
    // 以下三項也可以直接在網頁「設定」頁填寫，網頁上的設定優先
    channelSecret: env.LINE_CHANNEL_SECRET || '',
    accessToken: env.LINE_CHANNEL_ACCESS_TOKEN || '',
    adminPassword: env.ADMIN_PASSWORD || '',
    storageDir: path.resolve(env.STORAGE_DIR || path.join(ROOT, 'storage')),
    dataDir: path.resolve(env.DATA_DIR || path.join(ROOT, 'data')),
    rulesPath: path.resolve(env.RULES_PATH || path.join(ROOT, 'config', 'rules.json')),
    replyOnSave: env.REPLY_ON_SAVE ? /^(1|true|yes)$/i.test(env.REPLY_ON_SAVE) : undefined,
    lineApiBase: env.LINE_API_BASE || 'https://api.line.me',
    lineDataBase: env.LINE_DATA_API_BASE || 'https://api-data.line.me',
  };
}

const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** 給「活動紀錄」用：保留最近 200 筆，同時照常印到主控台 */
function createActivityLog(base) {
  const entries = [];
  const rec = level => (...args) => {
    const msg = args.map(a => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    entries.unshift({ at: new Date().toISOString(), level, msg });
    if (entries.length > 200) entries.pop();
    base[level]?.(...args);
  };
  return { entries, info: rec('info'), warn: rec('warn'), error: rec('error') };
}

export function createApp(config = loadConfig(), deps = {}) {
  fs.mkdirSync(config.storageDir, { recursive: true });
  const store = deps.store || new Store(config.dataDir);
  const settings = deps.settings || new Settings(config.dataDir, { env: config, defaultRulesPath: config.rulesPath });
  const classifier = deps.classifier || new Classifier(settings.rules);
  const line = deps.line || createLineClient({ token: () => settings.accessToken, apiBase: config.lineApiBase, dataBase: config.lineDataBase });
  const log = createActivityLog(deps.log || console);
  const ctx = { line, store, classifier, config, settings, log };
  const pending = new Set();
  const limiter = createLoginLimiter();
  store.data.status ||= { groups: {} };
  const status = store.data.status;

  const app = express();
  app.disable('x-powered-by');
  // 部署在 Caddy / Nginx / 雲端平台後面時，才能拿到使用者真正的 IP 與 https
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  // ---------- LINE webhook（不需要登入，靠簽章驗證）----------
  app.post('/webhook', express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
    if (!settings.channelSecret) {
      log.warn('收到 LINE webhook，但尚未設定 Channel secret（請到「設定」頁填寫）');
      return res.status(401).send('channel secret not configured');
    }
    if (!verifySignature(req.body, req.get('x-line-signature'), settings.channelSecret)) {
      log.warn('收到簽章錯誤的 webhook：Channel secret 可能填錯了');
      return res.status(401).send('bad signature');
    }
    let body;
    try { body = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).send('bad json'); }
    res.status(200).send('ok'); // 先回 200，LINE 要求快速回應
    status.lastWebhookAt = new Date().toISOString();
    if (!body.events?.length) log.info('收到 LINE 的 Webhook 驗證請求（Verify）✔');
    for (const ev of body.events || []) {
      const p = processEvent(ev)
        .catch(e => log.error('處理事件失敗：', e.message))
        .finally(() => pending.delete(p));
      pending.add(p);
    }
    store.save();
  });

  async function processEvent(ev) {
    const gid = ev.source?.groupId;
    if (gid && !status.groups[gid]) {
      let name = '群組';
      try { name = await line.getGroupName(gid); } catch {}
      status.groups[gid] = { name, since: new Date().toISOString() };
      if (ev.type !== 'join') log.info(`偵測到群組「${name}」`);
    }
    if (ev.type === 'join' && gid) log.info(`Bot 已加入群組「${status.groups[gid].name}」`);
    if (ev.type === 'leave' && gid) { log.info(`Bot 已離開群組「${status.groups[gid]?.name || gid}」`); delete status.groups[gid]; }
    const rec = await handleEvent(ev, ctx);
    if (rec) {
      status.lastFileAt = rec.createdAt;
      log.info(`已收下「${rec.originalName}」→ ${rec.folder}（${rec.uploader.name}）`);
    }
    await store.save();
  }

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // ---------- 登入 ----------
  app.use(express.json());
  const loggedIn = req => isLoggedIn(req, settings);

  app.get('/api/session', (req, res) => res.json({ configured: settings.passwordConfigured, loggedIn: loggedIn(req) }));

  // 第一次使用：建立管理密碼（只有在還沒設定密碼時可以呼叫）
  app.post('/api/setup', h(async (req, res) => {
    if (settings.passwordConfigured) return res.status(403).json({ error: '已經設定過密碼了' });
    const pw = String(req.body.password || '');
    if (pw.length < 6) return res.status(400).json({ error: '密碼至少 6 個字' });
    await settings.setPassword(pw);
    setSession(req, res, settings);
    log.info('已建立管理密碼');
    res.json({ ok: true });
  }));

  app.post('/api/login', (req, res) => {
    if (limiter.blocked(req.ip)) return res.status(429).json({ error: '嘗試太多次，請 15 分鐘後再試' });
    if (!settings.checkPassword(req.body.password)) {
      limiter.fail(req.ip);
      return res.status(401).json({ error: '密碼錯誤' });
    }
    limiter.ok(req.ip);
    setSession(req, res, settings);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

  // 未登入：網頁導向登入頁，API 回 401
  const PUBLIC_FILES = /^\/(login\.html|style\.css|login\.js|common\.js|favicon\.svg)$/;
  app.use((req, res, next) => {
    if (PUBLIC_FILES.test(req.path) || loggedIn(req)) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: '請先登入' });
    res.redirect('/login.html');
  });
  // 防 CSRF：修改資料的請求必須帶自訂標頭（跨網站的表單送不出這個標頭）
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.get('x-requested-with') !== 'fetch') return res.status(403).json({ error: '請求被拒絕' });
    next();
  });
  app.use(express.static(path.join(ROOT, 'public')));

  const view = f => ({ ...f, icon: classifier.iconFor(f.category) });

  function query(req) {
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
    return [...list].sort(cmp);
  }

  app.get('/api/files', (req, res) => {
    const list = query(req);
    res.json({ files: list.map(view), total: list.length });
  });

  // 把目前篩選結果打包成 ZIP 下載（例如「王小明上傳的全部檔案」）
  app.get('/api/export.zip', (req, res) => {
    const list = query(req);
    const zip = new yazl.ZipFile();
    for (const f of list) {
      const abs = resolveInside(config.storageDir, f.path);
      if (fs.existsSync(abs)) zip.addFile(abs, f.path, { compress: !/^(jpe?g|png|gif|webp|heic|mp4|mov|m4a|mp3|zip|rar|7z|gz)$/.test(f.ext) });
    }
    const who = [].concat(req.query.tag || []).find(t => t.startsWith('@'));
    const name = `LINE檔案${who ? '_' + who.slice(1) : ''}${req.query.category ? '_' + req.query.category : ''}_${new Date().toISOString().slice(0, 10)}.zip`;
    res.attachment(sanitizeFilename(name));
    zip.outputStream.pipe(res);
    zip.end();
  });

  // 完整備份：所有檔案 + 資料庫（可用來搬家）
  app.get('/api/backup.zip', h(async (req, res) => {
    await store.save();
    const zip = new yazl.ZipFile();
    zip.addFile(store.file, 'db.json');
    for (const f of store.all()) {
      const abs = resolveInside(config.storageDir, f.path);
      if (fs.existsSync(abs)) zip.addFile(abs, 'storage/' + f.path, { compress: false });
    }
    res.attachment(`line-file-bot-backup_${new Date().toISOString().slice(0, 10)}.zip`);
    zip.outputStream.pipe(res);
    zip.end();
  }));

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

  // ---------- 設定 ----------
  const mask = v => (v ? '•'.repeat(8) + v.slice(-4) : '');
  app.get('/api/settings', (req, res) => {
    res.json({
      channelSecretSet: Boolean(settings.channelSecret), channelSecretHint: mask(settings.channelSecret),
      accessTokenSet: Boolean(settings.accessToken), accessTokenHint: mask(settings.accessToken),
      replyOnSave: settings.replyOnSave,
      rules: settings.rules,
      customRules: Boolean(settings.data.rules),
    });
  });

  app.put('/api/settings', h(async (req, res) => {
    const { channelSecret, accessToken, replyOnSave, rules } = req.body;
    try {
      await settings.update({ channelSecret, accessToken, replyOnSave, rules });
    } catch (e) { return res.status(400).json({ error: e.message }); }
    if (rules !== undefined) { classifier.setRules(settings.rules); log.info('已更新分類規則'); }
    if (channelSecret !== undefined || accessToken !== undefined) log.info('已更新 LINE 金鑰');
    res.json({ ok: true });
  }));

  app.post('/api/settings/password', h(async (req, res) => {
    if (!settings.checkPassword(req.body.current)) return res.status(400).json({ error: '目前的密碼不正確' });
    if (String(req.body.next || '').length < 6) return res.status(400).json({ error: '新密碼至少 6 個字' });
    await settings.setPassword(req.body.next);
    setSession(req, res, settings); // 舊的登入全部失效，只保留目前這個
    log.info('已變更管理密碼');
    res.json({ ok: true });
  }));

  // 測試 LINE 金鑰，並檢查 LINE 後台的 webhook 網址是否正確
  app.post('/api/settings/test-line', h(async (req, res) => {
    if (!settings.accessToken) return res.json({ ok: false, error: '尚未填寫 Channel access token' });
    try {
      const bot = await line.getBotInfo();
      let webhook = null;
      try { webhook = await line.getWebhookEndpoint(); } catch {}
      res.json({ ok: true, bot: { name: bot.displayName, basicId: bot.basicId, pictureUrl: bot.pictureUrl }, webhook });
    } catch (e) {
      res.json({ ok: false, error: e.message });
    }
  }));

  // 依目前規則重新分類全部檔案（會搬移資料夾，手動加的標籤會保留）
  app.post('/api/reclassify', h(async (req, res) => {
    let moved = 0;
    // 舊規則和新規則的分類名稱都要從標籤裡拿掉
    const known = new Set([...classifier.categoryList().map(c => c.name), ...store.all().map(f => f.category)]);
    for (const f of store.all()) {
      const cls = classifier.classify(f.originalName, f.lineType);
      if (cls.folder === f.folder) continue;
      const from = resolveInside(config.storageDir, f.path);
      if (!fs.existsSync(from)) continue;
      const dir = resolveInside(config.storageDir, cls.folder);
      await fsp.mkdir(dir, { recursive: true });
      const name = uniqueName(dir, f.storedName);
      await moveFile(from, path.join(dir, name));
      await removeEmptyParents(config.storageDir, path.dirname(from));
      const tags = f.tags.filter(t => t !== f.category && !known.has(t));
      f.tags = [...new Set([...tags, cls.category, ...cls.tags])];
      Object.assign(f, { category: cls.category, folder: cls.folder, storedName: name, path: `${cls.folder}/${name}` });
      moved++;
    }
    await store.save();
    log.info(`重新分類完成，搬移了 ${moved} 個檔案`);
    res.json({ moved });
  }));

  app.get('/api/activity', (req, res) => {
    res.json({ entries: log.entries.slice(0, 100), status, totalFiles: store.all().length });
  });

  app.use((err, req, res, next) => {
    log.error(err);
    res.status(500).json({ error: err.message || '伺服器錯誤' });
  });


  app.locals.ctx = ctx;
  app.locals.idle = () => Promise.all([...pending]);
  return app;
}

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp, loadConfig } from '../src/app.js';

const SECRET = 'test-secret';
let mock, server, base, tmp, app, cookie = '';
// 已登入的請求
const authed = (url, opts = {}) => fetch(base + url, { ...opts, headers: { cookie, 'x-requested-with': 'fetch', ...(opts.body && typeof opts.body === 'string' ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) } });

// 假的 LINE API
function startMockLine() {
  return new Promise(res => {
    const s = http.createServer((req, resp) => {
      if (req.headers.authorization !== 'Bearer test-token') { resp.writeHead(401); return resp.end(); }
      let m;
      if ((m = req.url.match(/^\/v2\/bot\/message\/(\w+)\/content$/))) {
        const map = { m1: ['application/pdf', '%PDF-1.4 quote'], m2: ['image/jpeg', 'JPEGDATA'], m3: ['application/zip', 'PK'] };
        const [type, body] = map[m[1]];
        resp.writeHead(200, { 'Content-Type': type }); return resp.end(body);
      }
      if ((m = req.url.match(/^\/v2\/bot\/group\/(\w+)\/member\/(\w+)$/))) {
        resp.writeHead(200, { 'Content-Type': 'application/json' });
        return resp.end(JSON.stringify({ displayName: { U1: '王小明', U2: 'Amy' }[m[2]], userId: m[2] }));
      }
      if (req.url === '/v2/bot/info') {
        resp.writeHead(200, { 'Content-Type': 'application/json' });
        return resp.end(JSON.stringify({ displayName: '檔案小幫手', basicId: '@123abc' }));
      }
      if (req.url === '/v2/bot/channel/webhook/endpoint') {
        resp.writeHead(200, { 'Content-Type': 'application/json' });
        return resp.end(JSON.stringify({ endpoint: 'https://example.com/webhook', active: true }));
      }
      if (req.url.match(/^\/v2\/bot\/group\/\w+\/summary$/)) {
        resp.writeHead(200, { 'Content-Type': 'application/json' });
        return resp.end(JSON.stringify({ groupName: '專案群組' }));
      }
      resp.writeHead(404); resp.end();
    }).listen(0, () => res(s));
  });
}

const sign = body => crypto.createHmac('sha256', SECRET).update(body).digest('base64');
const ev = (id, type, userId, extra = {}) => ({
  type: 'message', timestamp: Date.UTC(2026, 10, 27, 3, 4, 5), replyToken: 'r',
  source: { type: 'group', groupId: 'G1', userId }, message: { id, type, ...extra },
});

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lfb-'));
  mock = await startMockLine();
  const mb = `http://127.0.0.1:${mock.address().port}`;
  const config = loadConfig({
        STORAGE_DIR: path.join(tmp, 'storage'), DATA_DIR: path.join(tmp, 'data'),
    LINE_API_BASE: mb, LINE_DATA_API_BASE: mb,
  });
  app = createApp(config, { log: { info() {}, warn() {}, error: console.error } });
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); mock.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('第一次使用：建立密碼、登入、未登入時擋下', async () => {
  let r = await fetch(base + '/api/files');
  assert.equal(r.status, 401);
  r = await fetch(base + '/', { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login.html');
  assert.equal((await fetch(base + '/login.html')).status, 200);
  assert.deepEqual(await (await fetch(base + '/api/session')).json(), { configured: false, loggedIn: false });

  r = await fetch(base + '/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'secret123' }) });
  assert.equal(r.status, 200);
  cookie = r.headers.get('set-cookie').split(';')[0];
  assert.equal((await authed('/api/files')).status, 200);

  // 已設定後不能再 setup 搶走
  r = await fetch(base + '/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'hacker1' }) });
  assert.equal(r.status, 403);
  r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) });
  assert.equal(r.status, 401);
  r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'secret123' }) });
  assert.equal(r.status, 200);
  // 修改資料時缺少 X-Requested-With → 拒絕（防 CSRF）
  r = await fetch(base + '/api/settings', { method: 'PUT', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});

test('在網頁上設定 LINE 金鑰後 webhook 立即生效', async () => {
  const body = JSON.stringify({ events: [] });
  let r = await fetch(base + '/webhook', { method: 'POST', body, headers: { 'x-line-signature': sign(body) } });
  assert.equal(r.status, 401); // 尚未設定 secret
  r = await authed('/api/settings', { method: 'PUT', body: JSON.stringify({ channelSecret: SECRET, accessToken: 'test-token' }) });
  assert.equal(r.status, 200);
  r = await fetch(base + '/webhook', { method: 'POST', body, headers: { 'x-line-signature': sign(body) } });
  assert.equal(r.status, 200);
  const st = await (await authed('/api/settings')).json();
  assert.equal(st.channelSecretSet, true);
  assert.ok(!JSON.stringify(st).includes(SECRET), '不應回傳完整的 secret');
  const t = await (await authed('/api/settings/test-line', { method: 'POST' })).json();
  assert.equal(t.ok, true);
  assert.equal(t.bot.name, '檔案小幫手');
  const act = await (await authed('/api/activity')).json();
  assert.ok(act.entries.some(e => e.msg.includes('Verify')));
});

test('拒絕簽章錯誤的 webhook', async () => {
  const r = await fetch(base + '/webhook', { method: 'POST', body: '{}', headers: { 'x-line-signature': 'nope' } });
  assert.equal(r.status, 401);
});

test('下載、分類、加標籤、匯出、改規則', async () => {
  const body = JSON.stringify({ events: [
    { type: 'join', timestamp: Date.now(), source: { type: 'group', groupId: 'G1' } },
    ev('m1', 'file', 'U1', { fileName: '2026年報價單_v2.pdf', fileSize: 15 }),
    ev('m2', 'image', 'U2'),
    ev('m3', 'file', 'U1', { fileName: '../../etc/passwd.zip' }),
    { type: 'message', source: { type: 'group', groupId: 'G1', userId: 'U1' }, message: { id: 't', type: 'text', text: 'hi' } },
  ] });
  const r = await fetch(base + '/webhook', { method: 'POST', body, headers: { 'x-line-signature': sign(body), 'content-type': 'application/json' } });
  assert.equal(r.status, 200);
  await app.locals.idle();

  const { files } = await (await authed('/api/files')).json();
  assert.equal(files.length, 3);
  const pdf = files.find(f => f.messageId === 'm1');
  assert.equal(pdf.path, '文件/報價單/2026年報價單_v2.pdf');
  assert.deepEqual(pdf.tags.sort(), ['@王小明', '報價單', '文件', '群:專案群組'].sort());
  const img = files.find(f => f.messageId === 'm2');
  assert.equal(img.category, '圖片');
  assert.match(img.originalName, /^圖片_\d{8}_\d{6}\.jpg$/);
  assert.ok(img.tags.includes('@Amy'));
  const zip = files.find(f => f.messageId === 'm3');
  assert.ok(zip.path.startsWith('壓縮檔/'), zip.path);
  assert.ok(!zip.path.split('/').includes('..') && zip.path.split('/').length === 2, zip.path);

  const act = await (await authed('/api/activity')).json();
  assert.equal(act.status.groups.G1.name, '專案群組');

  // 依上傳者標籤篩選
  const byMing = await (await authed('/api/files?tag=' + encodeURIComponent('@王小明'))).json();
  assert.equal(byMing.total, 2);

  // 把這個人的檔案打包成 ZIP
  const z = await authed('/api/export.zip?tag=' + encodeURIComponent('@王小明'));
  assert.equal(z.status, 200);
  const buf = Buffer.from(await z.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString(), 'PK');
  assert.ok(buf.includes(Buffer.from('文件/報價單/2026年報價單_v2.pdf')));
  assert.ok(!buf.includes(Buffer.from('圖片/')));
  assert.equal((await authed('/api/backup.zip')).status, 200);

  // facets
  const facets = await (await authed('/api/facets')).json();
  assert.deepEqual(facets.uploaders.map(u => u.name).sort(), ['@Amy', '@王小明']);

  // 重送相同事件不會重複
  await fetch(base + '/webhook', { method: 'POST', body, headers: { 'x-line-signature': sign(body) } });
  await app.locals.idle();
  assert.equal((await (await authed('/api/files')).json()).total, 3);

  // 改分類 → 檔案搬移、標籤同步
  const moved = await (await authed(`/api/files/${pdf.id}`, { method: 'PATCH', body: JSON.stringify({ category: '試算表', tags: [...pdf.tags, '重要'] }) })).json();
  assert.equal(moved.path, '試算表/報價單/2026年報價單_v2.pdf');
  assert.ok(moved.tags.includes('試算表') && !moved.tags.includes('文件') && moved.tags.includes('重要'));
  const dl = await authed(`/api/files/${pdf.id}/download`);
  assert.equal(await dl.text(), '%PDF-1.4 quote');

  // 在網頁上改分類規則 → 重新整理現有檔案
  const { rules } = await (await authed('/api/settings')).json();
  rules.categories.find(c => c.name === '文件').name = '文書';
  rules.keywordRules = rules.keywordRules.filter(k => k.tag !== '報價單');
  assert.equal((await authed('/api/settings', { method: 'PUT', body: JSON.stringify({ rules }) })).status, 200);
  const rc = await (await authed('/api/reclassify', { method: 'POST' })).json();
  assert.ok(rc.moved >= 1);
  const after = await (await authed(`/api/files/${pdf.id}`)).json();
  assert.equal(after.path, '文書/2026年報價單_v2.pdf');
  assert.ok(after.tags.includes('文書') && after.tags.includes('重要') && after.tags.includes('@王小明') && !after.tags.includes('試算表'));
  // 不合法的規則會被拒絕
  assert.equal((await authed('/api/settings', { method: 'PUT', body: JSON.stringify({ rules: { categories: [] } }) })).status, 400);

  // 刪除
  assert.equal((await authed(`/api/files/${img.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await authed(`/api/files/${img.id}/download`)).status, 404);
});

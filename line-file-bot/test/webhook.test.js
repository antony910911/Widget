import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp, loadConfig } from '../src/app.js';

const SECRET = 'test-secret';
let mock, server, base, tmp, app;

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
    LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: 'test-token',
    STORAGE_DIR: path.join(tmp, 'storage'), DATA_DIR: path.join(tmp, 'data'),
    LINE_API_BASE: mb, LINE_DATA_API_BASE: mb,
  });
  app = createApp(config, { log: { info() {}, warn() {}, error: console.error } });
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); mock.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('拒絕簽章錯誤的 webhook', async () => {
  const r = await fetch(base + '/webhook', { method: 'POST', body: '{}', headers: { 'x-line-signature': 'nope' } });
  assert.equal(r.status, 401);
});

test('下載、分類、加標籤', async () => {
  const body = JSON.stringify({ events: [
    ev('m1', 'file', 'U1', { fileName: '2026年報價單_v2.pdf', fileSize: 15 }),
    ev('m2', 'image', 'U2'),
    ev('m3', 'file', 'U1', { fileName: '../../etc/passwd.zip' }),
    { type: 'message', source: { type: 'group', groupId: 'G1', userId: 'U1' }, message: { id: 't', type: 'text', text: 'hi' } },
  ] });
  const r = await fetch(base + '/webhook', { method: 'POST', body, headers: { 'x-line-signature': sign(body), 'content-type': 'application/json' } });
  assert.equal(r.status, 200);
  await app.locals.idle();

  const { files } = await (await fetch(base + '/api/files')).json();
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

  // 依上傳者標籤篩選
  const byMing = await (await fetch(base + '/api/files?tag=' + encodeURIComponent('@王小明'))).json();
  assert.equal(byMing.total, 2);

  // facets
  const facets = await (await fetch(base + '/api/facets')).json();
  assert.deepEqual(facets.uploaders.map(u => u.name).sort(), ['@Amy', '@王小明']);

  // 重送相同事件不會重複
  await fetch(base + '/webhook', { method: 'POST', body, headers: { 'x-line-signature': sign(body) } });
  await app.locals.idle();
  assert.equal((await (await fetch(base + '/api/files')).json()).total, 3);

  // 改分類 → 檔案搬移、標籤同步
  const moved = await (await fetch(`${base}/api/files/${pdf.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ category: '試算表', tags: [...pdf.tags, '重要'] }) })).json();
  assert.equal(moved.path, '試算表/報價單/2026年報價單_v2.pdf');
  assert.ok(moved.tags.includes('試算表') && !moved.tags.includes('文件') && moved.tags.includes('重要'));
  const dl = await fetch(`${base}/api/files/${pdf.id}/download`);
  assert.equal(await dl.text(), '%PDF-1.4 quote');

  // 刪除
  assert.equal((await fetch(`${base}/api/files/${img.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(`${base}/api/files/${img.id}/download`)).status, 404);
});

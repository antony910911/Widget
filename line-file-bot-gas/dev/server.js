// 本機預覽：用模擬的 Google 服務執行 dist/Code.gs，並提供 dist/Index.html
//   node dev/server.js          → 全新狀態（會看到建立密碼畫面）
//   node dev/server.js --demo   → 放入示範資料（密碼 demo1234）
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createGas } = require('./gas-mock.js');
const { fakeCloud } = require('./fake-cloud.js');

const PORT = Number(process.env.PORT || 3200);
const demo = process.argv.includes('--demo');

function gradientPng(w, h, a, b) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const t = (x / w + y / h) / 2, o = y * (w * 3 + 1) + 1 + x * 3; for (let i = 0; i < 3; i++) raw[o + i] = a[i] + (b[i] - a[i]) * t; }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const demoFiles = [
  ['2026Q4_報價單_客戶A.pdf', 'U1'], ['會議紀錄_1125.docx', 'U2'], ['年度預算表.xlsx', 'U3'], ['新品發表企劃提案.pptx', 'U4'],
  ['logo_設計稿_v3.png', 'U1'], [null, 'U2'], ['產品介紹影片.mp4', 'U3'], ['客戶訪談錄音.m4a', 'U4'], ['合約_範本_最終版.docx', 'U1'],
  ['素材包.zip', 'U2'], ['十一月發票.pdf', 'U3'], [null, 'U4'], ['UI_mockup.fig', 'U1'], ['銷售數據.csv', 'U4'], ['海報_design.psd', 'U1'],
];
const palettes = [[[255, 179, 71], [255, 95, 109]], [[67, 206, 162], [24, 90, 157]], [[132, 94, 247], [236, 72, 153]]];
const content = {};
demoFiles.forEach(([name], i) => {
  const isImg = !name || /\.png$/.test(name);
  content['d' + i] = isImg ? ['image/png', gradientPng(240, 180, ...palettes[i % 3])] : ['application/octet-stream', Buffer.alloc(2000 + i * 40000, 65)];
});
const cloud = fakeCloud(content, { U3: '陳怡君', U4: '林志豪' });
const gas = createGas({ fetch: cloud.handler, webAppUrl: 'https://script.google.com/macros/s/AKfycbx_demo/exec' });

if (demo) {
  const t = gas.call('apiSetup', 'demo1234');
  gas.call('apiSaveSettings', t, { lineToken: 'line-token' });
  gas.doPost(gas.props.WEBHOOK_KEY, { events: [{ type: 'join', source: { type: 'group', groupId: 'G1' } }] });
  const base = Date.now() - 15 * 86400000;
  demoFiles.forEach(([name, uid], i) => {
    gas.doPost(gas.props.WEBHOOK_KEY, { events: [{
      type: 'message', timestamp: base + i * 86400000 * (0.8 + (i % 3) * 0.2), source: { type: 'group', groupId: 'G1', userId: uid },
      message: name ? { id: 'd' + i, type: 'file', fileName: name } : { id: 'd' + i, type: 'image' },
    }] });
  });
  console.log('已放入示範資料，密碼：demo1234');
}

const shim = `<script>
window.google = { script: { run: (function make(ok, fail) {
  return new Proxy({}, { get(_, fn) {
    if (fn === 'withSuccessHandler') return h => make(h, fail);
    if (fn === 'withFailureHandler') return h => make(ok, h);
    return (...args) => fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn, args }) })
      .then(r => r.json()).then(r => r.ok ? ok && ok(r.result) : fail && fail(new Error(r.error)));
  } });
})() } };
</script>`;

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/rpc') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const { fn, args } = JSON.parse(body);
      let out;
      try { out = { ok: true, result: gas.call(fn, ...args) }; } catch (e) { out = { ok: false, error: e.message }; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
    });
    return;
  }
  const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'Index.html'), 'utf8')
    .replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1"><title>LINE 檔案櫃（本機預覽）</title>' + shim);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
}).listen(PORT, () => console.log('本機預覽：http://localhost:' + PORT));

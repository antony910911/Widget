// 產生示範資料，方便先看看管理介面長怎樣：npm run seed-demo && npm start
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { loadConfig } from '../src/app.js';
import { Store } from '../src/store.js';
import { Classifier } from '../src/classifier.js';
import { placeFile } from '../src/files.js';
import { uploaderTag } from '../src/ingest.js';

const config = loadConfig();
const store = new Store(config.dataDir);
const cls = new Classifier(config.rulesPath);
const people = ['王小明', '陳怡君', 'Amy Lin', '林志豪'];
const groups = ['產品開發群組', '行銷部'];
const names = [
  '2026Q4_報價單_客戶A.pdf', '會議紀錄_1125.docx', '年度預算表.xlsx', '新品發表企劃提案.pptx', 'logo_設計稿_v3.png',
  '活動現場照片.jpg', '產品介紹影片.mp4', '客戶訪談錄音.m4a', '合約_範本_最終版.docx', '素材包.zip', '十一月發票.pdf',
  '使用者調查報告.pdf', 'UI_mockup.fig', 'API規格.json', '銷售數據.csv', '展場配置圖.dwg', '海報_design.psd', '團隊合照.jpg',
];
// 產生一張漸層 PNG 當示範圖片
function gradientPng(w, h, [r1, g1, b1], [r2, g2, b2]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = (x / w + y / h) / 2, o = y * (w * 3 + 1) + 1 + x * 3;
    raw[o] = r1 + (r2 - r1) * t; raw[o + 1] = g1 + (g2 - g1) * t; raw[o + 2] = b1 + (b2 - b1) * t;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PALETTES = [[[255, 179, 71], [255, 95, 109]], [[67, 206, 162], [24, 90, 157]], [[132, 94, 247], [236, 72, 153]]];
let imgN = 0;
const tmpDir = path.join(config.storageDir, '.tmp');
fs.mkdirSync(tmpDir, { recursive: true });
let t = Date.now() - 86400000 * 20;
for (const [i, name] of names.entries()) {
  const who = people[i % people.length];
  const grp = groups[i % 3 === 0 ? 1 : 0];
  const c = cls.classify(name);
  const tmp = path.join(tmpDir, crypto.randomUUID());
  fs.writeFileSync(tmp, c.category === '圖片' ? gradientPng(320, 240, ...PALETTES[imgN++ % 3]) : Buffer.alloc(1024 * (5 + i * 37), 65));
  const { relPath, storedName } = await placeFile(config.storageDir, tmp, c.folder, name);
  t += 86400000 * (0.5 + Math.random());
  await store.add({
    messageId: 'demo-' + i, lineType: 'file', originalName: name, storedName, path: relPath, folder: c.folder,
    ext: path.extname(name).slice(1), mime: '', size: fs.statSync(path.join(config.storageDir, relPath)).size,
    category: c.category, uploader: { id: null, name: who }, source: { type: 'group', id: null, name: grp },
    tags: [...new Set([uploaderTag(who), c.category, ...c.tags, '群:' + grp])], uploadedAt: new Date(t).toISOString(),
  });
}
console.log(`已建立 ${names.length} 筆示範檔案 → ${config.storageDir}`);

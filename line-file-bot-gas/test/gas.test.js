const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('../dev/gas-mock.js');

const { fakeCloud } = require('../dev/fake-cloud.js');

const fileEv = (id, type, userId, extra = {}) => ({
  type: 'message', timestamp: Date.UTC(2026, 10, 27, 3, 4, 5), replyToken: 'r',
  source: { type: 'group', groupId: 'G1', userId }, message: Object.assign({ id, type }, extra),
});

function setup() {
  const cloud = fakeCloud();
  const gas = createGas({ fetch: cloud.handler });
  return { gas, cloud };
}
const pathOf = f => f.pathStr();
const driveFiles = gas => [...gas.drive.files.values()].filter(f => !f.trashed).map(pathOf).sort();

test('安全：除了 doGet / doPost / api* 之外的全域函式都以底線結尾', () => {
  const { gas } = setup();
  const builtins = ['Date', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Error', 'Buffer'];
  const exposed = Object.keys(gas.context).filter(k => typeof gas.context[k] === 'function' && !k.endsWith('_') && !builtins.includes(k));
  const bad = exposed.filter(k => !/^(doGet|doPost|api[A-Z]\w*)$/.test(k));
  assert.deepEqual(bad, [], '這些函式可以被網頁直接呼叫：' + bad.join(', '));
  assert.ok(exposed.includes('apiFiles') && exposed.includes('doPost'));
});

test('首次設定、登入、未登入時拒絕', () => {
  const { gas } = setup();
  assert.deepEqual(gas.call('apiSession', null), { configured: false, loggedIn: false });
  assert.throws(() => gas.call('apiFiles', null), /AUTH/);
  assert.throws(() => gas.call('apiSetup', '123'), /至少 6/);
  const t = gas.call('apiSetup', 'secret123');
  assert.equal(gas.call('apiSession', t).loggedIn, true);
  assert.throws(() => gas.call('apiSetup', 'hacker1'), /已經設定過/);
  assert.throws(() => gas.call('apiLogin', 'nope'), /密碼錯誤/);
  const t2 = gas.call('apiLogin', 'secret123');
  assert.equal(gas.call('apiFiles', t2).files.length, 0);
  // 試算表與 Google 雲端硬碟資料夾已建立
  assert.ok(gas.props.SHEET_ID && gas.props.GDRIVE_ROOT_ID);
  // 改密碼後舊 token 失效
  const t3 = gas.call('apiChangePassword', t2, 'secret123', 'newpass99');
  assert.equal(gas.call('apiSession', t).loggedIn, false);
  assert.equal(gas.call('apiSession', t3).loggedIn, true);
});

test('Google 雲端硬碟：下載、分類、標籤、改分類、刪除、重新分類', () => {
  const { gas } = setup();
  const t = gas.call('apiSetup', 'secret123');
  gas.call('apiSaveSettings', t, { lineToken: 'line-token' });
  const s = gas.call('apiSettings', t);
  const key = s.webhookUrl.split('key=')[1];
  assert.ok(key.length >= 32);
  assert.equal(gas.call('apiTestLine', t).bot.name, '檔案小幫手');

  // key 錯誤 → 忽略
  gas.doPost('wrong', { events: [fileEv('m1', 'file', 'U1', { fileName: 'x.pdf' })] });
  assert.equal(gas.call('apiFiles', t).files.length, 0);

  gas.doPost(key, { events: [
    { type: 'join', source: { type: 'group', groupId: 'G1' } },
    fileEv('m1', 'file', 'U1', { fileName: '2026年報價單_v2.pdf', fileSize: 13 }),
    fileEv('m2', 'image', 'U2'),
    fileEv('m3', 'file', 'U1', { fileName: '../../etc/passwd.zip' }),
    fileEv('m4', 'file', 'U2', { fileName: '=HYPERLINK("http://evil").pdf' }),
    fileEv('big', 'file', 'U2', { fileName: 'huge.mp4', fileSize: 80 * 1024 * 1024 }),
    { type: 'message', source: { type: 'group', groupId: 'G1', userId: 'U1' }, message: { id: 't', type: 'text', text: 'hi' } },
  ] });
  // 重送不重複
  gas.doPost(key, { events: [fileEv('m1', 'file', 'U1', { fileName: '2026年報價單_v2.pdf' })] });

  const { files } = gas.call('apiFiles', t);
  assert.equal(files.length, 4);
  assert.deepEqual(driveFiles(gas), [
    '我的雲端硬碟/LINE 檔案櫃/圖片/圖片_20261127_110405.jpg',
    '我的雲端硬碟/LINE 檔案櫃/壓縮檔/__.._etc_passwd.zip',
    '我的雲端硬碟/LINE 檔案櫃/文件/=HYPERLINK(_http___evil_).pdf',
    '我的雲端硬碟/LINE 檔案櫃/文件/報價單/2026年報價單_v2.pdf',
  ].sort());
  const pdf = files.find(f => f.messageId === 'm1');
  assert.deepEqual(pdf.tags, ['@王小明', '文件', '報價單', '群:專案群組']);
  assert.equal(pdf.folder, '文件/報價單');
  assert.equal(pdf.storage, 'gdrive');
  assert.equal(pdf.icon, 'doc');
  assert.match(pdf.url, /^https:\/\/drive\.google\.com\/file\//);
  // 試算表公式注入防護
  assert.equal(gas.context.cell_('=HYPERLINK("x")'), "'=HYPERLINK(\"x\")");
  assert.equal(gas.context.cell_('123456789012345678'), "'123456789012345678");
  const act = gas.call('apiActivity', t);
  assert.ok(act.entries.some(e => /超過 50 MB/.test(e.msg)));
  assert.ok(act.entries.some(e => /key 不正確/.test(e.msg)));
  assert.equal(act.groups.G1.name, '專案群組');
  // 縮圖
  const img = files.find(f => f.messageId === 'm2');
  assert.match(gas.call('apiThumbs', t, [img.id])[img.id], /^data:image\/jpeg;base64,/);

  // 改分類 + 加標籤
  const moved = gas.call('apiUpdateFile', t, pdf.id, { category: '試算表', tags: pdf.tags.concat(['重要']) });
  assert.equal(moved.path, '試算表/報價單/2026年報價單_v2.pdf');
  assert.ok(moved.tags.includes('試算表') && !moved.tags.includes('文件') && moved.tags.includes('重要'));
  assert.ok(driveFiles(gas).includes('我的雲端硬碟/LINE 檔案櫃/試算表/報價單/2026年報價單_v2.pdf'));
  // 改名
  const renamed = gas.call('apiUpdateFile', t, pdf.id, { name: '最終報價.pdf' });
  assert.equal(renamed.path, '試算表/報價單/最終報價.pdf');

  // 改規則 → 重新分類
  const rules = gas.call('apiSettings', t).rules;
  rules.categories.find(c => c.name === '文件').name = '文書';
  rules.keywordRules = rules.keywordRules.filter(k => k.tag !== '報價單');
  gas.call('apiSaveSettings', t, { rules });
  const rc = gas.call('apiReclassify', t);
  assert.ok(rc.moved >= 2, JSON.stringify(rc));
  const after = gas.call('apiFiles', t).files.find(f => f.id === pdf.id);
  assert.equal(after.path, '文書/最終報價.pdf');
  assert.ok(after.tags.includes('重要') && after.tags.includes('@王小明') && after.tags.includes('文書'));
  assert.throws(() => gas.call('apiSaveSettings', t, { rules: { categories: [] } }), /至少要有一個分類/);

  // 刪除 → 進垃圾桶
  gas.call('apiDeleteFile', t, img.id);
  assert.equal(gas.call('apiFiles', t).files.length, 3);
  assert.ok(!driveFiles(gas).some(p => p.includes('圖片_')));
});

test('OneDrive：裝置代碼登入、上傳（含大檔分段）、搬移、刪除', () => {
  const { gas, cloud } = setup();
  const t = gas.call('apiSetup', 'secret123');
  gas.call('apiSaveSettings', t, { lineToken: 'line-token' });
  const key = gas.props.WEBHOOK_KEY;
  assert.throws(() => gas.call('apiUseStorage', t, 'onedrive'), /請先連接/);
  assert.throws(() => gas.call('apiOneDriveStart', t, 'bad'), /格式不對/);
  const cid = '11111111-2222-3333-4444-555555555555';
  const start = gas.call('apiOneDriveStart', t, cid);
  assert.equal(start.userCode, 'ABCD-EFGH');
  assert.equal(gas.call('apiOneDrivePoll', t, cid, start.deviceCode).status, 'pending');
  const ok = gas.call('apiOneDrivePoll', t, cid, start.deviceCode);
  assert.deepEqual(ok, { status: 'ok', account: 'me@outlook.com' });
  gas.call('apiUseStorage', t, 'onedrive');
  assert.equal(gas.call('apiSettings', t).storage, 'onedrive');

  gas.doPost(key, { events: [fileEv('m1', 'file', 'U1', { fileName: '報價單.pdf' }), fileEv('m5', 'file', 'U1', { fileName: '大檔.pdf' })] });
  assert.deepEqual(cloud.od.uploads, ['LINE 檔案櫃/文件/報價單/報價單.pdf']);
  assert.ok(cloud.od.folders.has('LINE 檔案櫃/文件/報價單'), [...cloud.od.folders].join(' ; '));
  assert.equal(cloud.od.chunks.length, 1); // 9 MB < 10 MB 一段
  assert.match(cloud.od.chunks[0], /^bytes 0-9437183\/9437184$/);
  const files = gas.call('apiFiles', t).files;
  assert.equal(files.length, 2);
  const f = files.find(x => x.name === '報價單.pdf');
  assert.equal(f.storage, 'onedrive');
  assert.equal(gas.call('apiThumbs', t, [f.id])[f.id], 'https://thumb.onedrive.test/x.jpg');

  const moved = gas.call('apiUpdateFile', t, f.id, { category: '簡報' });
  assert.equal(moved.path, '簡報/報價單/報價單.pdf');
  assert.equal(cloud.od.files.get(f.fileId), 'LINE 檔案櫃/簡報/報價單/報價單.pdf');
  gas.call('apiDeleteFile', t, f.id);
  assert.ok(!cloud.od.files.has(f.fileId));
  // Google 雲端硬碟裡沒有檔案（只有試算表）
  assert.equal(driveFiles(gas).length, 0);

  gas.call('apiDisconnectStorage', t, 'onedrive');
  assert.equal(gas.call('apiSettings', t).storage, 'gdrive');
});

test('Dropbox：授權碼連接、中文路徑上傳、搬移', () => {
  const { gas, cloud } = setup();
  const t = gas.call('apiSetup', 'secret123');
  gas.call('apiSaveSettings', t, { lineToken: 'line-token' });
  assert.match(gas.call('apiDropboxAuthUrl', t, 'appkey1'), /client_id=appkey1&response_type=code&token_access_type=offline/);
  assert.throws(() => gas.call('apiDropboxConnect', t, 'appkey1', 'sec', 'bad-code'), /連接失敗/);
  assert.equal(gas.call('apiDropboxConnect', t, 'appkey1', 'sec', 'good-code'), 'me@dropbox.test');
  gas.call('apiUseStorage', t, 'dropbox');
  gas.doPost(gas.props.WEBHOOK_KEY, { events: [fileEv('m6', 'file', 'U2', { fileName: '會議紀錄.pdf' })] });
  assert.deepEqual(cloud.dbx.uploads, ['/LINE 檔案櫃/文件/會議紀錄.pdf']);
  const f = gas.call('apiFiles', t).files[0];
  assert.deepEqual(f.tags, ['@Amy', '文件', '會議紀錄', '群:專案群組']);
  const moved = gas.call('apiUpdateFile', t, f.id, { name: '1127 會議紀錄.pdf' });
  assert.equal(cloud.dbx.files.get(f.fileId), '/LINE 檔案櫃/文件/1127 會議紀錄.pdf');
  assert.equal(moved.name, '1127 會議紀錄.pdf');
});

test('LINE 金鑰錯誤時，測試連線回報清楚的錯誤', () => {
  const { gas } = setup();
  const t = gas.call('apiSetup', 'secret123');
  gas.call('apiSaveSettings', t, { lineToken: 'wrong' });
  const r = gas.call('apiTestLine', t);
  assert.equal(r.ok, false);
  assert.match(r.error, /401/);
});

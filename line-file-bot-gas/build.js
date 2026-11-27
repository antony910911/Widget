// 產生要貼到 Google Apps Script 的檔案：dist/Code.gs、dist/Index.html、dist/appsscript.json
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const src = fs.readdirSync(path.join(dir, 'src')).filter(f => f.endsWith('.js')).sort();
const header = '// LINE 檔案櫃（Google Apps Script 版）\n// 安裝：在 https://script.new 開新專案，把這整份貼進去取代原本內容 → 儲存 → 部署成網頁應用程式（執行身分：我／存取權：所有人）\n\n';
const code = header + src.map(f => `// ===== ${f} =====\n` + fs.readFileSync(path.join(dir, 'src', f), 'utf8')).join('\n');
const ui = fs.readFileSync(path.join(dir, 'ui', 'index.html'), 'utf8')
  .replace('/*__STYLES__*/', () => fs.readFileSync(path.join(dir, 'ui', 'styles.css'), 'utf8'))
  .replace('/*__SCRIPT__*/', () => fs.readFileSync(path.join(dir, 'ui', 'app.js'), 'utf8'));
fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
// 單一檔案：把網頁一起包進 Code.gs，安裝時只要貼一個檔案
const single = code + '\n// ===== 網頁介面（由 ui/ 產生，請勿手動修改）=====\nconst INDEX_HTML = ' + JSON.stringify(ui) + ';\n';
fs.writeFileSync(path.join(dir, 'dist', 'Code.gs'), single);
fs.writeFileSync(path.join(dir, 'dist', 'Index.html'), ui);
fs.copyFileSync(path.join(dir, 'appsscript.json'), path.join(dir, 'dist', 'appsscript.json'));
// 安裝頁：內含整份程式碼與複製按鈕
const built = new Date().toISOString().slice(0, 10);
const installer = fs.readFileSync(path.join(dir, 'dev', 'installer.html'), 'utf8')
  .replace('__CODE_B64__', () => Buffer.from(single).toString('base64'))
  .replace('__BUILT__', built);
fs.writeFileSync(path.join(dir, 'dist', 'install.html'), installer);
console.log('已產生 dist/install.html、 dist/Code.gs（單一檔案，含網頁）、dist/Index.html、dist/appsscript.json');

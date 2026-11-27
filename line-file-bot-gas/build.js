// 產生要貼到 Google Apps Script 的檔案：dist/Code.gs、dist/Index.html、dist/appsscript.json
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const src = fs.readdirSync(path.join(dir, 'src')).filter(f => f.endsWith('.js')).sort();
const header = '// LINE 檔案櫃（Google Apps Script 版）— 由 build.js 產生，請整份貼到 Apps Script 的 Code.gs\n\n';
const code = header + src.map(f => `// ===== ${f} =====\n` + fs.readFileSync(path.join(dir, 'src', f), 'utf8')).join('\n');
const ui = fs.readFileSync(path.join(dir, 'ui', 'index.html'), 'utf8')
  .replace('/*__STYLES__*/', () => fs.readFileSync(path.join(dir, 'ui', 'styles.css'), 'utf8'))
  .replace('/*__SCRIPT__*/', () => fs.readFileSync(path.join(dir, 'ui', 'app.js'), 'utf8'));
fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
fs.writeFileSync(path.join(dir, 'dist', 'Code.gs'), code);
fs.writeFileSync(path.join(dir, 'dist', 'Index.html'), ui);
fs.copyFileSync(path.join(dir, 'appsscript.json'), path.join(dir, 'dist', 'appsscript.json'));
console.log('已產生 dist/Code.gs、dist/Index.html、dist/appsscript.json');

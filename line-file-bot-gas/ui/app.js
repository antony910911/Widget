'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} },
};
let token = store.get('lfb_token');

/** 呼叫 Apps Script 伺服器函式（自動帶上登入 token） */
function call(fn, ...args) {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(resolve)
      .withFailureHandler(err => {
        const msg = (err && err.message) || String(err);
        if (msg.indexOf('AUTH:') >= 0) { token = null; store.set('lfb_token', null); showAuth(); }
        reject(new Error(msg.replace(/^.*?AUTH:\s*/, '').replace(/^Error:\s*/, '')));
      })[fn](...args);
  });
}
const api = (fn, ...args) => call(fn, token, ...args);

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}
async function copyText(text, input) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) { input.focus(); input.select(); try { document.execCommand('copy'); } catch (e2) {} }
  toast('已複製');
}

const fmtSize = b => { if (!b) return '0 B'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(4, Math.floor(Math.log(b) / Math.log(1024))); return (b / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i]; };
const fmtDate = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }) + ' ' + d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }); };
const fmtShort = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }); };
const fmtTime = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }) + ' ' + d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); };

// ================= 登入 =================
let setupMode = false;
function showView(id) { ['loadingView', 'authView', 'appView'].forEach(v => { $('#' + v).hidden = v !== id; }); }
async function showAuth() {
  showView('authView');
  const s = await call('apiSession', token);
  setupMode = !s.configured;
  $('#authTitle').textContent = setupMode ? '歡迎使用 👋' : '登入';
  $('#authLead').textContent = setupMode ? '第一步：建立管理密碼，之後用它登入這個管理介面（至少 6 個字）。' : '輸入管理密碼';
  $('#pw2Wrap').hidden = !setupMode; $('#pw2').required = setupMode;
  $('#authBtn').textContent = setupMode ? '建立密碼並開始' : '登入';
  $('#pw').focus();
}
$('#authForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#authErr').textContent = '';
  $('#authBtn').disabled = true;
  try {
    if (setupMode && $('#pw').value !== $('#pw2').value) throw new Error('兩次輸入的密碼不一樣');
    token = await call(setupMode ? 'apiSetup' : 'apiLogin', $('#pw').value);
    store.set('lfb_token', token);
    $('#pw').value = $('#pw2').value = '';
    startApp(setupMode ? 'settings' : 'files');
  } catch (err) { $('#authErr').textContent = err.message; }
  finally { $('#authBtn').disabled = false; }
});
$('#logoutBtn').onclick = async () => { await api('apiLogout').catch(() => {}); token = null; store.set('lfb_token', null); showAuth(); };

// ================= 分頁 =================
let currentTab = 'files';
function setTab(tab) {
  currentTab = tab;
  document.querySelectorAll('[data-tab]').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  document.querySelectorAll('[data-only]').forEach(el => { el.style.display = el.dataset.only === tab ? '' : 'none'; });
  $('#filesTab').hidden = tab !== 'files';
  $('#settingsTab').hidden = tab !== 'settings';
  if (tab === 'settings') loadSettings(); else loadFiles();
  window.scrollTo(0, 0);
}
document.addEventListener('click', e => {
  const a = e.target.closest('[data-tab], a[href="#settings"]');
  if (!a) return;
  e.preventDefault();
  setTab(a.dataset.tab || 'settings');
});

async function startApp(tab) {
  showView('appView');
  setTab(tab || 'files');
}

// ================= 檔案頁 =================
const TYPE_COLORS = { doc: '#2f6fde', sheet: '#16a34a', slide: '#ea7a1a', image: '#8b5cf6', video: '#e0457b', audio: '#0ea5a4', archive: '#a16207', design: '#c026d3', code: '#475569', file: '#7c8594' };
const EXT_COLORS = { pdf: '#e0383e', txt: '#64748b' };
function fileIcon(icon, ext, cls) {
  const color = EXT_COLORS[ext] || TYPE_COLORS[icon] || TYPE_COLORS.file;
  const label = (ext || icon || 'file').slice(0, 4).toUpperCase();
  const glyph = {
    image: '<circle cx="23" cy="28" r="4"/><path d="M14 46l10-10 6 6 6-8 10 12z"/>', video: '<path d="M25 25v16l13-8z"/>',
    audio: '<path d="M27 40V24l12-3v16"/><circle cx="24" cy="40" r="3"/><circle cx="36" cy="37" r="3"/>',
    archive: '<path d="M30 14v4m0 4v4m0 4v4"/><rect x="26" y="34" width="8" height="8" rx="1.5"/>',
    sheet: '<rect x="16" y="22" width="28" height="22" rx="2"/><path d="M16 29h28M16 36h28M26 22v22"/>',
    slide: '<rect x="15" y="22" width="30" height="20" rx="2"/><path d="M22 36l6-6 4 4 6-6"/>', code: '<path d="M24 26l-7 7 7 7M36 26l7 7-7 7"/>',
    design: '<circle cx="30" cy="32" r="10"/><path d="M30 22v20M20 32h20"/>',
  }[icon] || '<path d="M18 26h24M18 32h24M18 38h16"/>';
  return '<svg class="' + (cls || 'ficon') + '" viewBox="0 0 60 72" aria-hidden="true">' +
    '<path d="M6 4h34l14 14v48a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill="var(--panel)" stroke="' + color + '" stroke-width="2.4"/>' +
    '<path d="M40 4v10a4 4 0 0 0 4 4h10" fill="none" stroke="' + color + '" stroke-width="2.4"/>' +
    '<g stroke="' + color + '" stroke-width="2.4" fill="none" opacity=".55">' + glyph + '</g>' +
    '<rect x="2" y="50" width="44" height="16" rx="3" fill="' + color + '" stroke="none"/>' +
    '<text x="24" y="62" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" stroke="none" font-family="system-ui, sans-serif">' + esc(label) + '</text></svg>';
}
const AVATAR_COLORS = ['#06c755', '#2f6fde', '#ea7a1a', '#8b5cf6', '#e0457b', '#0ea5a4', '#a16207', '#475569'];
function avatar(name) {
  let h = 0; for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return '<span class="avatar" style="background:' + AVATAR_COLORS[h % AVATAR_COLORS.length] + '">' + esc(Array.from(String(name))[0] || '?') + '</span>';
}

const state = { all: [], files: [], categories: [], q: '', category: '', tags: new Set(), sort: 'newest', view: store.get('view') || 'grid', current: null, thumbs: {} };

async function loadFiles() {
  try {
    const r = await api('apiFiles');
    state.all = r.files; state.categories = r.categories;
    $('#sheetLink').href = r.sheetUrl; $('#sheetLink').hidden = false;
    applyFilters(); renderSidebar();
  } catch (e) { toast(e.message); }
  api('apiSettings').then(s => { $('#setupBanner').hidden = s.lineTokenSet; }).catch(() => {});
}

function applyFilters() {
  const needle = state.q.toLowerCase();
  const list = state.all.filter(f =>
    (!state.category || f.category === state.category) &&
    Array.from(state.tags).every(t => f.tags.indexOf(t) >= 0) &&
    (!needle || [f.name, f.uploader, f.source].concat(f.tags).join(' ').toLowerCase().indexOf(needle) >= 0));
  const cmp = {
    newest: (a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)),
    oldest: (a, b) => String(a.uploadedAt).localeCompare(String(b.uploadedAt)),
    name: (a, b) => a.name.localeCompare(b.name, 'zh-Hant'),
    size: (a, b) => b.size - a.size,
  }[state.sort];
  state.files = list.sort(cmp);
  renderFiles(); renderFilterbar();
}

function facets() {
  const tagCount = {}, catCount = {};
  state.all.forEach(f => {
    catCount[f.category] = (catCount[f.category] || 0) + 1;
    f.tags.forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; });
  });
  const tags = Object.keys(tagCount).map(n => ({ name: n, count: tagCount[n] })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    catCount: catCount,
    uploaders: tags.filter(t => t.name[0] === '@'),
    groups: tags.filter(t => t.name.indexOf('群:') === 0),
    tags: tags.filter(t => t.name[0] !== '@' && t.name.indexOf('群:') !== 0 && !catCount[t.name]),
  };
}

function renderSidebar() {
  const f = facets();
  $('#statCount').textContent = state.all.length;
  $('#statSize').textContent = fmtSize(state.all.reduce((s, x) => s + x.size, 0));
  $('#catList').innerHTML = '<li><button data-cat="" class="' + (state.category ? '' : 'on') + '">' + fileIcon('file', 'all', 'mini-icon') + '<span class="name">全部檔案</span><span class="count">' + state.all.length + '</span></button></li>' +
    state.categories.map(c => '<li><button data-cat="' + esc(c.name) + '" class="' + (state.category === c.name ? 'on' : '') + ' ' + (f.catCount[c.name] ? '' : 'zero') + '">' + fileIcon(c.icon, '', 'mini-icon') + '<span class="name">' + esc(c.name) + '</span><span class="count">' + (f.catCount[c.name] || 0) + '</span></button></li>').join('');
  $('#uploaderList').innerHTML = f.uploaders.map(u => { const n = u.name.slice(1); return '<li><button data-tag="' + esc(u.name) + '" class="' + (state.tags.has(u.name) ? 'on' : '') + '">' + avatar(n) + '<span class="name">' + esc(n) + '</span><span class="count">' + u.count + '</span></button></li>'; }).join('') || '<li class="hint" style="padding:0 8px">尚無</li>';
  $('#groupHead').hidden = !f.groups.length;
  $('#groupList').innerHTML = f.groups.map(g => '<li><button data-tag="' + esc(g.name) + '" class="' + (state.tags.has(g.name) ? 'on' : '') + '"><svg viewBox="0 0 24 24"><circle cx="9" cy="9" r="3.2"/><circle cx="17" cy="10" r="2.5"/><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5M15 15.2c2.6-.6 5.3.7 6 3.8"/></svg><span class="name">' + esc(g.name.slice(2)) + '</span><span class="count">' + g.count + '</span></button></li>').join('');
  $('#tagCloud').innerHTML = f.tags.map(t => '<button class="chip ' + (state.tags.has(t.name) ? 'on' : '') + '" data-tag="' + esc(t.name) + '">' + esc(t.name) + ' <span style="opacity:.6">' + t.count + '</span></button>').join('') || '<span class="hint">尚無標籤</span>';
}
$('#sidebar').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.cat !== undefined) state.category = b.dataset.cat;
  else if (b.dataset.tag) { state.tags.has(b.dataset.tag) ? state.tags.delete(b.dataset.tag) : state.tags.add(b.dataset.tag); }
  else return;
  renderSidebar(); applyFilters(); closeSidebar();
});

function tagLabel(t) { return t[0] === '@' ? '👤 ' + t.slice(1) : t.indexOf('群:') === 0 ? '👥 ' + t.slice(2) : '# ' + t; }
function renderFilterbar() {
  const items = [];
  if (state.category) items.push('<span class="chip on" data-rm-cat>📁 ' + esc(state.category) + ' <button class="x" aria-label="移除">×</button></span>');
  state.tags.forEach(t => items.push('<span class="chip on" data-rm-tag="' + esc(t) + '">' + esc(tagLabel(t)) + ' <button class="x" aria-label="移除">×</button></span>'));
  $('#filterbar').hidden = !items.length;
  $('#filterbar').innerHTML = '<span class="label">篩選：</span>' + items.join('') + '<button class="clear" data-clear>清除全部</button>';
  const who = Array.from(state.tags).filter(t => t[0] === '@').map(t => t.slice(1));
  $('#resultText').textContent = (who.length === 1 ? who[0] + ' 上傳的檔案 · ' : '') + '共 ' + state.files.length + ' 個檔案' + (state.q ? '（搜尋「' + state.q + '」）' : '');
}
$('#filterbar').addEventListener('click', e => {
  const c = e.target.closest('[data-rm-cat],[data-rm-tag],[data-clear]'); if (!c) return;
  if (c.hasAttribute('data-clear')) { state.category = ''; state.tags.clear(); }
  else if (c.hasAttribute('data-rm-cat')) state.category = '';
  else state.tags.delete(c.dataset.rmTag);
  renderSidebar(); applyFilters();
});

const isImage = f => f.icon === 'image' && f.ext !== 'heic';
function thumbHtml(f, big) {
  const t = state.thumbs[f.id];
  if (isImage(f) && t) return '<img loading="lazy" src="' + esc(t) + '" alt="">';
  return fileIcon(f.icon, f.ext) ;
}
function renderFiles() {
  const el = $('#files');
  el.className = 'files ' + state.view;
  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.view === state.view));
  $('#empty').hidden = state.files.length > 0;
  $('#emptyText').textContent = state.all.length ? '沒有符合條件的檔案' : '還沒有檔案';
  if (!state.files.length) { el.innerHTML = ''; return; }
  if (state.view === 'grid') {
    el.innerHTML = state.files.map(f =>
      '<button class="card" data-id="' + esc(f.id) + '" title="' + esc(f.name) + '">' +
      '<div class="thumb" data-thumb="' + esc(f.id) + '">' + thumbHtml(f) + '</div>' +
      '<div class="info"><div class="fname">' + esc(f.name) + '</div>' +
      '<div class="meta">' + avatar(f.uploader) + '<span class="who">' + esc(f.uploader) + '</span><span>' + fmtShort(f.uploadedAt) + '</span></div></div></button>').join('');
    loadThumbs();
  } else {
    el.innerHTML = '<div class="row head"><span></span><span>檔名</span><span class="c-who">上傳者</span><span class="c-tags">標籤</span><span class="num">大小</span><span class="num c-date">上傳時間</span></div>' +
      state.files.map(f =>
        '<div class="row" data-id="' + esc(f.id) + '" tabindex="0">' + fileIcon(f.icon, f.ext) +
        '<div style="min-width:0"><div class="fname">' + esc(f.name) + '</div><div class="sub">' + esc(f.folder) + '</div></div>' +
        '<div class="who c-who">' + avatar(f.uploader) + '<span>' + esc(f.uploader) + '</span></div>' +
        '<div class="tags c-tags">' + f.tags.filter(t => t[0] !== '@' && t !== f.category).slice(0, 3).map(t => '<span class="chip">' + esc(t.indexOf('群:') === 0 ? t.slice(2) : t) + '</span>').join('') + '</div>' +
        '<div class="num">' + fmtSize(f.size) + '</div><div class="num c-date">' + fmtDate(f.uploadedAt) + '</div></div>').join('');
  }
}
let thumbBusy = false;
async function loadThumbs() {
  if (thumbBusy) return;
  const need = state.files.filter(f => isImage(f) && !(f.id in state.thumbs)).slice(0, 24).map(f => f.id);
  if (!need.length) return;
  thumbBusy = true;
  try {
    const got = await api('apiThumbs', need);
    need.forEach(id => { state.thumbs[id] = got[id] || null; });
    need.forEach(id => {
      const box = document.querySelector('[data-thumb="' + id + '"]');
      const f = state.all.filter(x => x.id === id)[0];
      if (box && f) box.innerHTML = thumbHtml(f);
    });
  } catch (e) { need.forEach(id => { state.thumbs[id] = null; }); }
  thumbBusy = false;
  if (state.files.some(f => isImage(f) && !(f.id in state.thumbs))) loadThumbs();
}
$('#files').addEventListener('click', e => { const it = e.target.closest('[data-id]'); if (it) openDrawer(it.dataset.id); });
$('#files').addEventListener('keydown', e => { if (e.key === 'Enter') { const it = e.target.closest('[data-id]'); if (it) openDrawer(it.dataset.id); } });

// ---------- 檔案詳細資訊 ----------
const STORAGE_LABEL = { gdrive: 'Google 雲端硬碟', onedrive: 'OneDrive', dropbox: 'Dropbox' };
function openDrawer(id) {
  const f = state.all.filter(x => x.id === id)[0]; if (!f) return;
  state.current = f;
  const where = STORAGE_LABEL[f.storage] || f.storage;
  $('#dTitle').textContent = f.category;
  $('#dBody').innerHTML =
    '<div class="preview">' + thumbHtml(f) + '</div>' +
    '<p class="d-name">' + esc(f.name) + '</p>' +
    '<div class="d-actions">' +
      '<a class="btn primary" href="' + esc(f.url) + '" target="_blank" rel="noopener">在 ' + esc(where) + ' 開啟 ↗</a>' +
      '<button class="btn" id="dRename">重新命名</button><button class="btn danger" id="dDelete">刪除</button></div>' +
    '<dl class="kv">' +
      '<dt>上傳者</dt><dd><a href="#" id="dWho">' + esc(f.uploader) + '</a></dd>' +
      '<dt>來源</dt><dd>' + esc(f.source) + '</dd>' +
      '<dt>上傳時間</dt><dd>' + fmtDate(f.uploadedAt) + '</dd>' +
      '<dt>大小</dt><dd>' + fmtSize(f.size) + '</dd>' +
      '<dt>存放位置</dt><dd>' + esc(where) + '<br><code>' + esc(f.path) + '</code></dd></dl>' +
    '<div class="field"><label for="dCat">分類資料夾</label><select id="dCat">' +
      state.categories.map(c => '<option ' + (c.name === f.category ? 'selected' : '') + '>' + esc(c.name) + '</option>').join('') +
    '</select><div class="hint">變更分類會把檔案搬到對應的資料夾。</div></div>' +
    '<div class="field"><label for="dTagInput">標籤</label><div class="tag-edit" id="dTags"></div><div class="hint">輸入後按 Enter 新增；@ 開頭代表上傳者。</div></div>';
  renderTagEditor();
  $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false');
  $('#dWho').onclick = e => { e.preventDefault(); state.tags = new Set(['@' + f.uploader]); state.category = ''; closeDrawer(); renderSidebar(); applyFilters(); };
  $('#dCat').onchange = e => save({ category: e.target.value }, '已移到「' + e.target.value + '」');
  $('#dDelete').onclick = async () => {
    if (!confirm('確定要刪除「' + f.name + '」？' + (f.storage === 'gdrive' ? '檔案會移到 Google 雲端硬碟的垃圾桶。' : '檔案會從 ' + where + ' 刪除。'))) return;
    try { await api('apiDeleteFile', f.id); closeDrawer(); toast('已刪除'); loadFiles(); } catch (e) { toast(e.message); }
  };
  $('#dRename').onclick = () => { const n = prompt('新的檔名', f.name); if (n && n.trim() && n !== f.name) save({ name: n.trim() }, '已重新命名'); };
}
function renderTagEditor() {
  const f = state.current;
  const fc = facets();
  $('#dTags').innerHTML = f.tags.map((t, i) => '<span class="chip ' + (t[0] === '@' ? 'person' : '') + '">' + esc(t) + '<button class="x" data-i="' + i + '" aria-label="移除標籤">×</button></span>').join('') +
    '<input id="dTagInput" placeholder="新增標籤…" list="tagSuggest"><datalist id="tagSuggest">' + fc.tags.concat(fc.uploaders).map(t => '<option value="' + esc(t.name) + '">').join('') + '</datalist>';
  $('#dTags').onclick = e => { const x = e.target.closest('.x'); if (x) save({ tags: f.tags.filter((_, i) => i !== +x.dataset.i) }); };
  $('#dTagInput').onkeydown = e => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      const v = e.target.value.trim();
      if (v && f.tags.indexOf(v) < 0) save({ tags: f.tags.concat([v]) }, '已新增標籤', true);
    }
  };
}
async function save(patch, msg, refocus) {
  try {
    const u = await api('apiUpdateFile', state.current.id, patch);
    const i = state.all.findIndex(x => x.id === u.id);
    if (i >= 0) state.all[i] = u;
    state.current = u;
    if (patch.tags) renderTagEditor(); else openDrawer(u.id);
    if (refocus) $('#dTagInput').focus();
    if (msg) toast(msg);
    renderSidebar(); applyFilters();
  } catch (e) { toast(e.message); }
}
function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); state.current = null; $('#dBody').innerHTML = ''; }
$('#dClose').onclick = closeDrawer;
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrawer(); closeSidebar(); } });

let qTimer;
$('#q').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value.trim(); applyFilters(); }, 150); });
$('#sort').addEventListener('change', e => { state.sort = e.target.value; applyFilters(); });
document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => { state.view = b.dataset.view; store.set('view', state.view); renderFiles(); }));
$('#refreshBtn').onclick = () => loadFiles().then(() => toast('已更新'));
const closeSidebar = () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); };
$('#menuBtn').onclick = () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); };
$('#scrim').onclick = closeSidebar;
setInterval(() => { if (!document.hidden && currentTab === 'files' && !state.current && token) loadFiles(); }, 60000);

// ================= 設定頁 =================
const ICONS = { doc: '文件', sheet: '試算表', slide: '簡報', image: '圖片', video: '影片', audio: '音訊', archive: '壓縮', design: '設計', code: '程式', file: '一般' };
let settings = null, activity = null, lineTest = null, rules = null;

async function loadSettings() {
  try {
    settings = await api('apiSettings');
    rules = JSON.parse(JSON.stringify(settings.rules));
    $('#webhookUrl').value = settings.webhookUrl;
    $('#token').value = '';
    $('#token').placeholder = settings.lineTokenSet ? '已設定（' + settings.lineTokenHint + '）— 留空表示不變更' : '貼上 Channel access token';
    $('#replyOnSave').checked = settings.replyOnSave;
    $('#rootFolder').value = settings.rootFolder;
    renderStorage(); renderRules();
    await loadActivity();
    if (settings.lineTokenSet && !lineTest) testLine(true).catch(() => {});
  } catch (e) { toast(e.message); }
}

function renderChecklist() {
  if (!settings || !activity) return;
  const groups = Object.keys(activity.groups || {}).map(k => activity.groups[k]);
  const wh = lineTest && lineTest.webhook;
  const whOk = wh ? wh.endpoint === settings.webhookUrl && wh.active : Boolean(activity.lastWebhookAt);
  const steps = [
    { done: true, title: '建立管理密碼' },
    { done: settings.lineTokenSet, title: '填入 LINE 金鑰', body: '在 <a href="https://developers.line.biz/console/" target="_blank" rel="noopener">LINE Developers</a> 建立 Messaging API channel，到 Messaging API 分頁最下方產生 Channel access token，貼到下方「LINE 連線」。' },
    { done: lineTest && lineTest.ok, title: '金鑰測試成功', body: lineTest && !lineTest.ok ? '<span class="bad">' + esc(lineTest.error) + '</span>' : '按下方「儲存並測試」。' },
    { done: whOk, title: '在 LINE 後台設定 Webhook',
      body: wh && wh.endpoint !== settings.webhookUrl ? 'LINE 後台目前填的是 <code>' + esc(wh.endpoint || '（空白）') + '</code>，請改成下方的 Webhook 網址（整串，包含 ?key=）。'
        : wh && !wh.active ? '網址正確，但「Use webhook」還沒開啟。'
        : 'Messaging API 分頁：貼上 Webhook 網址 → 開啟 Use webhook。同一頁把「Allow bot to join group chats」設為啟用，並到 LINE Official Account Manager 關閉「自動回應訊息」。（按 Verify 若顯示 302 錯誤可以忽略，看下方活動紀錄有沒有出現「驗證請求」即可）' },
    { done: groups.length > 0, title: '把 Bot 邀請進群組', body: groups.length ? '' : '用手機掃 Bot 的 QR code 加好友，再從群組「邀請」把它加進去。' },
    { done: activity.totalFiles > 0, title: '收到第一個檔案', body: '在群組傳一個檔案試試看，幾秒內就會出現在「檔案」頁。' },
  ];
  const all = steps.every(s => s.done);
  $('#checklistCard').classList.toggle('collapsed', all);
  $('#checklist').innerHTML = steps.map((s, i) => '<li class="' + (s.done ? 'done' : '') + '"><span class="dot">' + (s.done ? '✓' : i + 1) + '</span><div><b>' + s.title + '</b>' + (!s.done && s.body ? '<p>' + s.body + '</p>' : '') + '</div></li>').join('') +
    (all ? '<li class="all-done">🎉 全部完成！群組裡的檔案會自動存進雲端並出現在「檔案」頁。</li>' : '');
}

// ---------- LINE ----------
async function testLine(quiet) {
  const box = $('#testResult');
  if (!quiet) { box.hidden = false; box.className = 'test-result'; box.innerHTML = '<span class="spinner"></span> 測試中…'; }
  lineTest = await api('apiTestLine');
  if (lineTest.ok) {
    const b = lineTest.bot, wh = lineTest.webhook;
    box.className = 'test-result ok';
    box.innerHTML = (b.pictureUrl ? '<img src="' + esc(b.pictureUrl) + '" alt="">' : '') + '<div><b>✓ 已連上 ' + esc(b.name) + '</b> <span class="muted">' + esc(b.basicId || '') + '</span><div class="muted">' +
      (wh ? (wh.endpoint === settings.webhookUrl ? (wh.active ? 'LINE 後台 Webhook 網址正確，且已啟用' : 'Webhook 網址正確，但尚未開啟 Use webhook') : 'LINE 後台的 Webhook 網址和這裡不同，請重新貼上') : '') + '</div></div>';
  } else { box.className = 'test-result bad'; box.textContent = '✗ ' + lineTest.error; }
  box.hidden = false;
  renderChecklist();
}
$('#copyWebhook').onclick = () => copyText($('#webhookUrl').value, $('#webhookUrl'));
$('#saveLine').onclick = async () => {
  try {
    const t = $('#token').value.trim();
    if (t) { await api('apiSaveSettings', { lineToken: t }); toast('已儲存'); }
    settings = await api('apiSettings');
    $('#token').value = ''; $('#token').placeholder = settings.lineTokenSet ? '已設定（' + settings.lineTokenHint + '）— 留空表示不變更' : '貼上 Channel access token';
    await testLine();
  } catch (e) { toast(e.message); }
};
$('#testLine').onclick = () => testLine().catch(e => toast(e.message));
$('#replyOnSave').onchange = e => api('apiSaveSettings', { replyOnSave: e.target.checked }).then(() => toast(e.target.checked ? '收到檔案時會在群組回覆' : '不會在群組回覆')).catch(err => toast(err.message));

// ---------- 儲存位置 ----------
const STORAGE_META = {
  gdrive: { logo: 'G', color: '#1a73e8', desc: '免設定，使用你部署這個程式的 Google 帳號。' },
  onedrive: { logo: 'O', color: '#0364b8', desc: '個人或公司帳號皆可。需要先到 Azure 註冊應用程式（約 5 分鐘）。' },
  dropbox: { logo: 'D', color: '#0061fe', desc: '需要先在 Dropbox App Console 建立 App（約 3 分鐘）。' },
};
function renderStorage() {
  const cards = settings.storages.map(s => {
    const m = STORAGE_META[s.id] || { logo: s.label[0], color: '#475569', desc: '' };
    const active = settings.storage === s.id;
    return '<div class="storage-card ' + (active ? 'active' : '') + '">' + (active ? '<span class="s-badge">使用中</span>' : '') +
      '<div class="s-head"><span class="s-logo" style="background:' + m.color + '">' + esc(m.logo) + '</span>' + esc(s.label) + '</div>' +
      '<div class="s-state ' + (s.ready ? 'on' : '') + '">' + (s.ready ? '✓ 已連接' + (s.account ? '：' + esc(s.account) : '') : '尚未連接') + '</div>' +
      '<div class="muted" style="font-size:12px">' + m.desc + '</div>' +
      '<div class="s-actions">' +
        (s.ready && !active ? '<button class="btn small primary" data-use="' + s.id + '">改用這個</button>' : '') +
        (!s.ready ? '<button class="btn small primary" data-connect="' + s.id + '">連接</button>' : '') +
        (s.ready && s.id !== 'gdrive' ? '<button class="btn small" data-connect="' + s.id + '">重新連接</button><button class="btn small ghost" data-disconnect="' + s.id + '">中斷</button>' : '') +
      '</div></div>';
  });
  cards.push('<div class="storage-card disabled"><div class="s-head"><span class="s-logo" style="background:#8e8e93"></span>iCloud 雲碟</div>' +
    '<div class="s-state">無法連接</div><div class="muted" style="font-size:12px">Apple 沒有開放 iCloud 雲碟給第三方程式寫入。想在 iPhone 上看檔案，可以安裝 Google Drive 或 OneDrive App，它們會出現在 iPhone 的「檔案」App 裡，和 iCloud 放在一起。</div></div>');
  $('#storageGrid').innerHTML = cards.join('');
}
$('#storageGrid').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  try {
    if (b.dataset.use) { await api('apiUseStorage', b.dataset.use); toast('之後的檔案會存到 ' + STORAGE_LABEL[b.dataset.use]); }
    else if (b.dataset.disconnect) { if (!confirm('確定要中斷連接？已存在那裡的檔案不會被刪除，但介面上無法再搬移或刪除它們。')) return; await api('apiDisconnectStorage', b.dataset.disconnect); toast('已中斷連接'); }
    else if (b.dataset.connect) { showConnect(b.dataset.connect); return; }
    settings = await api('apiSettings'); renderStorage();
  } catch (err) { toast(err.message); }
});

let pollTimer = null;
function showConnect(id) {
  clearInterval(pollTimer);
  const p = $('#connectPanel');
  if (id === 'onedrive') {
    p.innerHTML = '<div class="connect-panel"><h3>連接 OneDrive</h3><ol>' +
      '<li>打開 <a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener">Azure 應用程式註冊 ↗</a>（用你的 Microsoft 帳號登入），按「<b>新增註冊</b>」</li>' +
      '<li>名稱隨意（例如 LINE 檔案櫃）；支援的帳戶類型選「<b>任何組織目錄中的帳戶及個人 Microsoft 帳戶</b>」；重新導向 URI 留空 → 註冊</li>' +
      '<li>左側「<b>驗證</b>」→ 最下方「<b>允許公用用戶端流程</b>」選「是」→ 儲存</li>' +
      '<li>回到「概觀」，複製「<b>應用程式 (用戶端) 識別碼</b>」貼到下面</li></ol>' +
      '<label class="field"><span>應用程式 (用戶端) 識別碼</span><input id="odClient" placeholder="例如 1a2b3c4d-5e6f-…" value="' + esc(settings.onedriveClientId) + '"></label>' +
      '<div class="row-actions"><button class="btn primary" id="odStart">開始登入</button><button class="btn ghost" id="cancelConnect">取消</button></div><div id="odStep"></div></div>';
    $('#odStart').onclick = async () => {
      const cid = $('#odClient').value.trim();
      try {
        const r = await api('apiOneDriveStart', cid);
        $('#odStep').innerHTML = '<div class="device-code"><span>到 <a href="' + esc(r.verificationUri) + '" target="_blank" rel="noopener">' + esc(r.verificationUri) + ' ↗</a> 輸入代碼：</span><span class="code">' + esc(r.userCode) + '</span><button class="btn small" id="copyCode">複製代碼</button></div><p class="muted"><span class="spinner"></span> 等待你在 Microsoft 頁面登入並按「接受」…</p>';
        $('#copyCode').onclick = () => { navigator.clipboard && navigator.clipboard.writeText(r.userCode).then(() => toast('已複製代碼'), () => {}); };
        const until = Date.now() + (r.expiresIn || 900) * 1000;
        pollTimer = setInterval(async () => {
          if (Date.now() > until) { clearInterval(pollTimer); $('#odStep').innerHTML = '<p class="bad">代碼已過期，請重新開始。</p>'; return; }
          try {
            const s = await api('apiOneDrivePoll', cid, r.deviceCode);
            if (s.status === 'ok') { clearInterval(pollTimer); p.innerHTML = ''; toast('已連接 OneDrive'); settings = await api('apiSettings'); renderStorage(); }
            else if (s.status === 'error') { clearInterval(pollTimer); $('#odStep').innerHTML = '<p class="bad">' + esc(s.error) + '</p>'; }
          } catch (err) { clearInterval(pollTimer); $('#odStep').innerHTML = '<p class="bad">' + esc(err.message) + '</p>'; }
        }, Math.max(5, r.interval) * 1000);
      } catch (err) { toast(err.message); }
    };
  } else if (id === 'dropbox') {
    p.innerHTML = '<div class="connect-panel"><h3>連接 Dropbox</h3><ol>' +
      '<li>打開 <a href="https://www.dropbox.com/developers/apps/create" target="_blank" rel="noopener">Dropbox App Console ↗</a>：選「<b>Scoped access</b>」→「<b>App folder</b>」（只能存取自己的資料夾，比較安全）→ 名稱隨意 → Create app</li>' +
      '<li>「<b>Permissions</b>」分頁勾選 <code>files.content.write</code>、<code>files.content.read</code>、<code>account_info.read</code> → 最下方 Submit</li>' +
      '<li>回到「<b>Settings</b>」分頁，複製 <b>App key</b> 和 <b>App secret</b> 貼到下面</li></ol>' +
      '<label class="field"><span>App key</span><input id="dbxKey" value="' + esc(settings.dropboxAppKey) + '"></label>' +
      '<label class="field"><span>App secret</span><input id="dbxSecret" type="password"></label>' +
      '<div class="row-actions"><button class="btn" id="dbxAuth">① 取得授權碼 ↗</button></div>' +
      '<label class="field"><span>② 在 Dropbox 按「允許」後，把顯示的授權碼貼在這裡</span><input id="dbxCode"></label>' +
      '<div class="row-actions"><button class="btn primary" id="dbxConnect">③ 連接</button><button class="btn ghost" id="cancelConnect">取消</button></div></div>';
    $('#dbxAuth').onclick = async () => {
      try { const url = await api('apiDropboxAuthUrl', $('#dbxKey').value); window.open(url, '_blank', 'noopener'); }
      catch (err) { toast(err.message); }
    };
    $('#dbxConnect').onclick = async () => {
      try {
        await api('apiDropboxConnect', $('#dbxKey').value, $('#dbxSecret').value, $('#dbxCode').value);
        p.innerHTML = ''; toast('已連接 Dropbox'); settings = await api('apiSettings'); renderStorage();
      } catch (err) { toast(err.message); }
    };
  }
  const c = $('#cancelConnect'); if (c) c.onclick = () => { clearInterval(pollTimer); p.innerHTML = ''; };
  p.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
$('#saveRoot').onclick = () => api('apiSaveSettings', { rootFolder: $('#rootFolder').value }).then(() => toast('已儲存')).catch(e => toast(e.message));

// ---------- 分類規則 ----------
function iconSelect(v) { return '<select data-k="icon">' + Object.keys(ICONS).map(k => '<option value="' + k + '" ' + (k === v ? 'selected' : '') + '>' + ICONS[k] + '</option>').join('') + '</select>'; }
function renderRules() {
  $('#catTable').innerHTML = '<div class="rt-head cat"><span>分類（資料夾）名稱</span><span>圖示</span><span>副檔名</span><span></span></div>' +
    rules.categories.map((c, i) => '<div class="rt-row cat" data-i="' + i + '"><input data-k="name" value="' + esc(c.name) + '" maxlength="30" aria-label="分類名稱">' + iconSelect(c.icon) +
      '<input data-k="exts" value="' + esc([].concat(c.exts).join(', ')) + '" aria-label="副檔名"><button class="icon-btn" data-del title="刪除">✕</button></div>').join('');
  $('#kwTable').innerHTML = '<div class="rt-head kw"><span>關鍵字</span><span>加上標籤</span><span>子資料夾（可空白）</span><span></span></div>' +
    rules.keywordRules.map((k, i) => '<div class="rt-row kw" data-i="' + i + '"><input data-k="keywords" value="' + esc([].concat(k.keywords).join(', ')) + '" aria-label="關鍵字">' +
      '<input data-k="tag" value="' + esc(k.tag || '') + '" maxlength="30" aria-label="標籤"><input data-k="folder" value="' + esc(k.folder || '') + '" maxlength="30" aria-label="子資料夾">' +
      '<button class="icon-btn" data-del title="刪除">✕</button></div>').join('');
  $('#fallbackName').value = (rules.fallbackCategory && rules.fallbackCategory.name) || '其他';
}
function bindTable(sel, key) {
  $(sel).addEventListener('input', e => { const r = e.target.closest('[data-i]'); if (r && e.target.dataset.k) rules[key][r.dataset.i][e.target.dataset.k] = e.target.value; });
  $(sel).addEventListener('click', e => { const r = e.target.closest('[data-i]'); if (r && e.target.closest('[data-del]')) { rules[key].splice(+r.dataset.i, 1); renderRules(); } });
}
bindTable('#catTable', 'categories');
bindTable('#kwTable', 'keywordRules');
$('#addCat').onclick = () => { rules.categories.push({ name: '', icon: 'file', exts: [] }); renderRules(); };
$('#addKw').onclick = () => { rules.keywordRules.push({ keywords: [], tag: '', folder: '' }); renderRules(); };
$('#fallbackName').oninput = e => { rules.fallbackCategory = { name: e.target.value, icon: 'file' }; };
async function saveRules() { await api('apiSaveSettings', { rules: rules }); settings = await api('apiSettings'); rules = JSON.parse(JSON.stringify(settings.rules)); renderRules(); }
$('#saveRules').onclick = () => saveRules().then(() => toast('規則已儲存，之後收到的檔案會套用新規則')).catch(e => toast(e.message));
$('#resetRules').onclick = async () => {
  if (!confirm('確定要還原成預設的分類規則？')) return;
  try { await api('apiSaveSettings', { rules: null }); settings = await api('apiSettings'); rules = JSON.parse(JSON.stringify(settings.rules)); renderRules(); toast('已還原預設規則'); } catch (e) { toast(e.message); }
};
$('#reclassify').onclick = async () => {
  if (!confirm('會先儲存目前的規則，再把所有現有檔案依規則重新搬到對應資料夾。\n\n・手動加的標籤會保留\n・之前手動改過分類的檔案，也會被改回規則判斷的分類\n・檔案多的話需要一點時間\n\n要繼續嗎？')) return;
  try { await saveRules(); toast('整理中…'); const r = await api('apiReclassify'); toast('完成，搬移了 ' + r.moved + ' 個檔案' + (r.failed ? '，' + r.failed + ' 個失敗（見活動紀錄）' : '')); state.all = []; loadActivity(); }
  catch (e) { toast(e.message); }
};

// ---------- 密碼、活動紀錄 ----------
$('#pwForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { token = await api('apiChangePassword', $('#pwCur').value, $('#pwNew').value); store.set('lfb_token', token); e.target.reset(); toast('密碼已變更，其他裝置需要重新登入'); }
  catch (err) { toast(err.message); }
});
async function loadActivity() {
  activity = await api('apiActivity');
  $('#statusLine').textContent = activity.lastWebhookAt ? '最後收到 LINE 訊息：' + fmtTime(activity.lastWebhookAt) : '尚未收到任何 LINE 訊息';
  $('#activity').innerHTML = activity.entries.map(e => '<li class="lv-' + esc(e.level) + '"><time>' + fmtTime(e.at) + '</time><span>' + esc(e.msg) + '</span></li>').join('') || '<li class="muted">還沒有紀錄。</li>';
  renderChecklist();
}
setInterval(() => { if (!document.hidden && currentTab === 'settings' && token) loadActivity().catch(() => {}); }, 10000);

// ================= 啟動 =================
(async () => {
  try {
    const s = await call('apiSession', token);
    if (s.loggedIn) startApp(location.hash === '#settings' ? 'settings' : 'files'); else showAuth();
  } catch (e) { showAuth(); }
})();

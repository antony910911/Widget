'use strict';
// $、esc、api、toast 定義在 common.js

const state = {
  q: '', category: '', tags: new Set(), sort: 'newest',
  view: (() => { try { return localStorage.getItem('view') || 'grid'; } catch { return 'grid'; } })(),
  files: [], facets: null, current: null,
};

// ---------- 檔案類型圖示 ----------
const TYPE_COLORS = {
  doc: '#2f6fde', sheet: '#16a34a', slide: '#ea7a1a', image: '#8b5cf6', video: '#e0457b',
  audio: '#0ea5a4', archive: '#a16207', design: '#c026d3', code: '#475569', file: '#7c8594',
};
const EXT_COLORS = { pdf: '#e0383e', doc: '#2f6fde', docx: '#2f6fde', txt: '#64748b' };

function fileIcon(icon, ext, cls = 'ficon') {
  const color = EXT_COLORS[ext] || TYPE_COLORS[icon] || TYPE_COLORS.file;
  const label = (ext || icon || 'file').slice(0, 4).toUpperCase();
  const glyph = {
    image: '<circle cx="23" cy="28" r="4"/><path d="M14 46l10-10 6 6 6-8 10 12z"/>',
    video: '<path d="M25 25v16l13-8z"/>',
    audio: '<path d="M27 40V24l12-3v16"/><circle cx="24" cy="40" r="3"/><circle cx="36" cy="37" r="3"/>',
    archive: '<path d="M30 14v4m0 4v4m0 4v4"/><rect x="26" y="34" width="8" height="8" rx="1.5"/>',
    sheet: '<rect x="16" y="22" width="28" height="22" rx="2"/><path d="M16 29h28M16 36h28M26 22v22"/>',
    slide: '<rect x="15" y="22" width="30" height="20" rx="2"/><path d="M22 36l6-6 4 4 6-6"/>',
    code: '<path d="M24 26l-7 7 7 7M36 26l7 7-7 7"/>',
    design: '<circle cx="30" cy="32" r="10"/><path d="M30 22v20M20 32h20"/>',
  }[icon] || '<path d="M18 26h24M18 32h24M18 38h16"/>';
  return `<svg class="${cls}" viewBox="0 0 60 72" aria-hidden="true">
    <path d="M6 4h34l14 14v48a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill="var(--panel)" stroke="${color}" stroke-width="2.4"/>
    <path d="M40 4v10a4 4 0 0 0 4 4h10" fill="none" stroke="${color}" stroke-width="2.4"/>
    <g stroke="${color}" stroke-width="2.4" fill="none" opacity=".55">${glyph}</g>
    <rect x="2" y="50" width="44" height="16" rx="3" fill="${color}" stroke="none"/>
    <text x="24" y="62" text-anchor="middle" font-size="11" font-weight="700" fill="#fff" stroke="none" font-family="system-ui, sans-serif">${esc(label)}</text>
  </svg>`;
}

// ---------- 頭像 ----------
const AVATAR_COLORS = ['#06c755', '#2f6fde', '#ea7a1a', '#8b5cf6', '#e0457b', '#0ea5a4', '#a16207', '#475569'];
function avatar(name) {
  let h = 0; for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return `<span class="avatar" style="background:${AVATAR_COLORS[h % AVATAR_COLORS.length]}">${esc([...name][0] || '?')}</span>`;
}

const fmtSize = b => { if (!b) return '0 B'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(4, Math.floor(Math.log(b) / Math.log(1024))); return (b / 1024 ** i).toFixed(i ? 1 : 0) + ' ' + u[i]; };
const fmtDate = s => { const d = new Date(s); return d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }) + ' ' + d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }); };
const fmtShort = s => { const d = new Date(s); return d.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }); };


// ---------- 載入 ----------
async function loadFacets() { state.facets = await api('/api/facets'); renderSidebar(); }
async function loadFiles() {
  const p = new URLSearchParams({ q: state.q, category: state.category, sort: state.sort });
  for (const t of state.tags) p.append('tag', t);
  const { files } = await api('/api/files?' + p);
  state.files = files;
  $('#zipBtn').href = '/api/export.zip?' + p;
  $('#zipBtn').hidden = !files.length;
  renderFiles(); renderFilterbar();
}
const refresh = () => Promise.all([loadFacets(), loadFiles()]);

// ---------- Sidebar ----------
function renderSidebar() {
  const f = state.facets;
  $('#statCount').textContent = f.total;
  $('#statSize').textContent = fmtSize(f.totalSize);
  $('#catList').innerHTML = `<li><button data-cat="" class="${state.category ? '' : 'on'}">${fileIcon('file', 'all', 'mini-icon')}<span class="name">全部檔案</span><span class="count">${f.total}</span></button></li>` +
    f.categories.map(c => `<li><button data-cat="${esc(c.name)}" class="${state.category === c.name ? 'on' : ''} ${c.count ? '' : 'zero'}">${fileIcon(c.icon, '', 'mini-icon')}<span class="name">${esc(c.name)}</span><span class="count">${c.count}</span></button></li>`).join('');
  $('#uploaderList').innerHTML = f.uploaders.map(u => { const n = u.name.slice(1); return `<li><button data-tag="${esc(u.name)}" class="${state.tags.has(u.name) ? 'on' : ''}">${avatar(n)}<span class="name">${esc(n)}</span><span class="count">${u.count}</span></button></li>`; }).join('') || '<li class="hint" style="padding:0 8px">尚無</li>';
  $('#groupHead').hidden = !f.groups.length;
  $('#groupList').innerHTML = f.groups.map(g => `<li><button data-tag="${esc(g.name)}" class="${state.tags.has(g.name) ? 'on' : ''}"><svg viewBox="0 0 24 24"><circle cx="9" cy="9" r="3.2"/><circle cx="17" cy="10" r="2.5"/><path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5M15 15.2c2.6-.6 5.3.7 6 3.8"/></svg><span class="name">${esc(g.name.slice(2))}</span><span class="count">${g.count}</span></button></li>`).join('');
  $('#tagCloud').innerHTML = f.tags.map(t => `<button class="chip ${state.tags.has(t.name) ? 'on' : ''}" data-tag="${esc(t.name)}">${esc(t.name)} <span style="opacity:.6">${t.count}</span></button>`).join('') || '<span class="hint">尚無標籤</span>';
}

$('#sidebar').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.cat !== undefined) state.category = b.dataset.cat;
  else if (b.dataset.tag) state.tags.has(b.dataset.tag) ? state.tags.delete(b.dataset.tag) : state.tags.add(b.dataset.tag);
  else return;
  renderSidebar(); loadFiles(); closeSidebar();
});

// ---------- 篩選列 ----------
function tagLabel(t) { return t.startsWith('@') ? '👤 ' + t.slice(1) : t.startsWith('群:') ? '👥 ' + t.slice(2) : '# ' + t; }
function renderFilterbar() {
  const fb = $('#filterbar');
  const items = [];
  if (state.category) items.push(`<span class="chip on" data-rm-cat>📁 ${esc(state.category)} <button class="x" aria-label="移除">×</button></span>`);
  for (const t of state.tags) items.push(`<span class="chip on" data-rm-tag="${esc(t)}">${esc(tagLabel(t))} <button class="x" aria-label="移除">×</button></span>`);
  fb.hidden = !items.length;
  fb.innerHTML = `<span class="label">篩選：</span>${items.join('')}<button class="clear" data-clear>清除全部</button>`;
  const who = [...state.tags].filter(t => t.startsWith('@')).map(t => t.slice(1));
  $('#resultText').textContent = (who.length === 1 ? `${who[0]} 上傳的檔案 · ` : '') + `共 ${state.files.length} 個檔案` + (state.q ? `（搜尋「${state.q}」）` : '');
}
$('#filterbar').addEventListener('click', e => {
  const chip = e.target.closest('[data-rm-cat],[data-rm-tag],[data-clear]'); if (!chip) return;
  if (chip.hasAttribute('data-clear')) { state.category = ''; state.tags.clear(); }
  else if (chip.hasAttribute('data-rm-cat')) state.category = '';
  else state.tags.delete(chip.dataset.rmTag);
  renderSidebar(); loadFiles();
});

// ---------- 檔案列表 ----------
function renderFiles() {
  const el = $('#files');
  el.className = 'files ' + state.view;
  document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.view === state.view));
  const empty = !state.files.length;
  $('#empty').hidden = !empty;
  $('#emptyText').textContent = state.facets?.total ? '沒有符合條件的檔案' : '還沒有檔案';
  if (empty) { el.innerHTML = ''; return; }
  if (state.view === 'grid') {
    el.innerHTML = state.files.map(f => `
      <button class="card" data-id="${f.id}" title="${esc(f.originalName)}">
        <div class="thumb">${f.icon === 'image' && f.ext !== 'heic' ? `<img loading="lazy" src="/api/files/${f.id}/raw" alt="" onerror="this.replaceWith(document.createRange().createContextualFragment(this.dataset.fb))" data-fb="${esc(fileIcon(f.icon, f.ext))}">` : fileIcon(f.icon, f.ext)}</div>
        <div class="info">
          <div class="fname">${esc(f.originalName)}</div>
          <div class="meta">${avatar(f.uploader.name)}<span class="who">${esc(f.uploader.name)}</span><span>${fmtShort(f.uploadedAt)}</span></div>
        </div>
      </button>`).join('');
  } else {
    el.innerHTML = `<div class="row head"><span></span><span>檔名</span><span class="c-who">上傳者</span><span class="c-tags">標籤</span><span class="num">大小</span><span class="num c-date">上傳時間</span></div>` +
      state.files.map(f => `
      <div class="row" data-id="${f.id}" tabindex="0">
        ${fileIcon(f.icon, f.ext)}
        <div style="min-width:0"><div class="fname">${esc(f.originalName)}</div><div class="sub">${esc(f.folder)}</div></div>
        <div class="who c-who">${avatar(f.uploader.name)}<span>${esc(f.uploader.name)}</span></div>
        <div class="tags c-tags">${f.tags.filter(t => !t.startsWith('@') && t !== f.category).slice(0, 3).map(t => `<span class="chip">${esc(t.startsWith('群:') ? t.slice(2) : t)}</span>`).join('')}</div>
        <div class="num">${fmtSize(f.size)}</div>
        <div class="num c-date">${fmtDate(f.uploadedAt)}</div>
      </div>`).join('');
  }
}
$('#files').addEventListener('click', e => { const it = e.target.closest('[data-id]'); if (it) openDrawer(it.dataset.id); });
$('#files').addEventListener('keydown', e => { if (e.key === 'Enter') { const it = e.target.closest('[data-id]'); if (it) openDrawer(it.dataset.id); } });

// ---------- 詳細資訊抽屜 ----------
function previewHtml(f) {
  const raw = `/api/files/${f.id}/raw`;
  if (f.icon === 'image' && f.ext !== 'heic') return `<img src="${raw}" alt="">`;
  if (f.icon === 'video') return `<video src="${raw}" controls preload="metadata"></video>`;
  if (f.icon === 'audio') return `<audio src="${raw}" controls preload="metadata"></audio>`;
  if (f.ext === 'pdf') return `<iframe src="${raw}" title="PDF 預覽"></iframe>`;
  return fileIcon(f.icon, f.ext);
}

function openDrawer(id) {
  const f = state.files.find(x => x.id === id); if (!f) return;
  state.current = f;
  const cats = state.facets.categories;
  $('#dTitle').textContent = f.category;
  $('#dBody').innerHTML = `
    <div class="preview">${previewHtml(f)}</div>
    <p class="d-name">${esc(f.originalName)}</p>
    <div class="d-actions">
      <a class="btn primary" href="/api/files/${f.id}/download"><svg viewBox="0 0 24 24"><path d="M12 4v12M6 10l6 6 6-6M4 20h16"/></svg>下載</a>
      <button class="btn" id="dRename">重新命名</button>
      <button class="btn danger" id="dDelete">刪除</button>
    </div>
    <dl class="kv">
      <dt>上傳者</dt><dd><a href="#" id="dWho">${esc(f.uploader.name)}</a></dd>
      <dt>來源</dt><dd>${esc(f.source?.name || '')}</dd>
      <dt>上傳時間</dt><dd>${fmtDate(f.uploadedAt)}</dd>
      <dt>大小</dt><dd>${fmtSize(f.size)}</dd>
      <dt>存放位置</dt><dd><code>${esc(f.path)}</code></dd>
    </dl>
    <div class="field">
      <label for="dCat">分類資料夾</label>
      <select id="dCat">${cats.map(c => `<option ${c.name === f.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <div class="hint">變更分類會把檔案移到對應的資料夾。</div>
    </div>
    <div class="field">
      <label for="dTagInput">標籤</label>
      <div class="tag-edit" id="dTags"></div>
      <div class="hint">輸入後按 Enter 新增；@開頭代表上傳者。</div>
    </div>`;
  renderTagEditor();
  $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false');

  $('#dWho').onclick = e => { e.preventDefault(); state.tags = new Set(['@' + f.uploader.name]); state.category = ''; closeDrawer(); renderSidebar(); loadFiles(); };
  $('#dCat').onchange = e => save({ category: e.target.value }, '已移到「' + e.target.value + '」');
  $('#dDelete').onclick = async () => {
    if (!confirm(`確定要刪除「${f.originalName}」？檔案會從磁碟移除。`)) return;
    await api(`/api/files/${f.id}`, { method: 'DELETE' }); closeDrawer(); toast('已刪除'); refresh();
  };
  $('#dRename').onclick = () => {
    const n = prompt('新的檔名', f.storedName);
    if (n && n.trim() && n !== f.storedName) save({ name: n.trim() }, '已重新命名');
  };
}

function renderTagEditor() {
  const f = state.current;
  $('#dTags').innerHTML = f.tags.map((t, i) => `<span class="chip ${t.startsWith('@') ? 'person' : ''}">${esc(t)}<button class="x" data-i="${i}" aria-label="移除標籤 ${esc(t)}">×</button></span>`).join('') +
    `<input id="dTagInput" placeholder="新增標籤…" list="tagSuggest"><datalist id="tagSuggest">${state.facets.tags.concat(state.facets.uploaders).map(t => `<option value="${esc(t.name)}">`).join('')}</datalist>`;
  $('#dTags').onclick = e => { const x = e.target.closest('.x'); if (x) { const tags = f.tags.filter((_, i) => i !== +x.dataset.i); save({ tags }); } };
  $('#dTagInput').onkeydown = e => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      const v = e.target.value.trim();
      if (v && !f.tags.includes(v)) save({ tags: [...f.tags, v] }, '已新增標籤', true);
    }
  };
}

async function save(patch, msg, refocus) {
  try {
    const updated = await api(`/api/files/${state.current.id}`, { method: 'PATCH', body: patch });
    const i = state.files.findIndex(x => x.id === updated.id);
    if (i >= 0) state.files[i] = updated;
    state.current = updated;
    if (patch.tags) renderTagEditor(); else openDrawer(updated.id);
    if (refocus) $('#dTagInput').focus();
    if (msg) toast(msg);
    loadFacets(); renderFiles();
  } catch (e) { toast(e.message); }
}

function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); state.current = null; $('#dBody').innerHTML = ''; }
$('#dClose').onclick = closeDrawer;
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrawer(); closeSidebar(); } });

// ---------- 上方工具列 ----------
let qTimer;
$('#q').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value.trim(); loadFiles(); }, 200); });
$('#sort').addEventListener('change', e => { state.sort = e.target.value; loadFiles(); });
document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
  state.view = b.dataset.view; try { localStorage.setItem('view', state.view); } catch {}
  renderFiles();
}));

// 手機版側欄
const closeSidebar = () => { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); };
$('#menuBtn').onclick = () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); };
$('#scrim').onclick = closeSidebar;

// ---------- 手動上傳（按鈕 / 拖放） ----------
async function upload(files) {
  for (const file of files) {
    await api('/api/upload', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) }, body: file });
  }
  toast(`已上傳 ${files.length} 個檔案`); refresh();
}
$('#uploadInput').addEventListener('change', e => { if (e.target.files.length) upload([...e.target.files]).catch(err => toast(err.message)); e.target.value = ''; });
let dragDepth = 0;
addEventListener('dragenter', e => { if (e.dataTransfer?.types.includes('Files')) { dragDepth++; $('#dropzone').classList.add('show'); } });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropzone').classList.remove('show'); } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; $('#dropzone').classList.remove('show'); if (e.dataTransfer.files.length) upload([...e.dataTransfer.files]).catch(err => toast(err.message)); });

// 每 30 秒自動更新，群組裡有新檔案就會出現
setInterval(() => { if (!document.hidden && !state.current) refresh(); }, 30000);
refresh().catch(e => toast(e.message));

// 還沒設定 LINE 金鑰時，提示到設定頁
api('/api/settings').then(s => { if (!s.channelSecretSet || !s.accessTokenSet) $('#setupBanner').hidden = false; }).catch(() => {});

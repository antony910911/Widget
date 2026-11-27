'use strict';
// 各頁面共用的小工具
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400);
}

async function api(url, opts = {}) {
  const headers = { 'X-Requested-With': 'fetch', ...(opts.headers || {}) };
  let body = opts.body;
  if (body && typeof body === 'object' && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
    headers['Content-Type'] = 'application/json'; body = JSON.stringify(body);
  }
  const r = await fetch(url, { ...opts, headers, body });
  if (r.status === 401 && !url.startsWith('/api/login')) { location.href = '/login.html'; throw new Error('請先登入'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `錯誤 ${r.status}`);
  return data;
}

async function logout() { await api('/api/logout', { method: 'POST' }).catch(() => {}); location.href = '/login.html'; }
document.addEventListener('click', e => { if (e.target.closest('[data-logout]')) { e.preventDefault(); logout(); } });

const fmtTime = s => { const d = new Date(s); return d.toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }) + ' ' + d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }); };

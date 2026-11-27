'use strict';
const ICONS = { doc: '文件', sheet: '試算表', slide: '簡報', image: '圖片', video: '影片', audio: '音訊', archive: '壓縮', design: '設計', code: '程式', file: '一般' };
const webhookUrl = location.origin + '/webhook';
let settings, activity, lineTest = null;

$('#webhookUrl').value = webhookUrl;
$('#httpsWarn').hidden = location.protocol === 'https:';
$('#copyWebhook').onclick = async () => {
  try { await navigator.clipboard.writeText(webhookUrl); } catch { $('#webhookUrl').select(); document.execCommand('copy'); }
  toast('已複製 Webhook 網址');
};

// ---------- 開始使用：進度清單 ----------
function renderChecklist() {
  if (!settings || !activity) return;
  const st = activity.status || {};
  const groups = Object.values(st.groups || {});
  const wh = lineTest?.webhook;
  const steps = [
    { done: true, title: '建立管理密碼' },
    { done: settings.channelSecretSet && settings.accessTokenSet, title: '填入 LINE 金鑰', body: '在 <a href="https://developers.line.biz/console/" target="_blank" rel="noopener">LINE Developers</a> 建立 Messaging API channel，把 Channel secret 和 Channel access token 貼到下方「LINE 連線」。', jump: '#line' },
    { done: lineTest?.ok, title: '金鑰測試成功', body: lineTest && !lineTest.ok ? `<span class="bad">${esc(lineTest.error)}</span>` : '按下方「儲存並測試」。' },
    { done: wh ? wh.endpoint === webhookUrl && wh.active : Boolean(st.lastWebhookAt), title: '在 LINE 後台設定 Webhook',
      body: wh && wh.endpoint !== webhookUrl ? `LINE 後台目前填的是 <code>${esc(wh.endpoint || '（空白）')}</code>，請改成上方的 Webhook 網址。`
        : wh && !wh.active ? '網址正確，但「Use webhook」還沒開啟。'
        : 'Messaging API 分頁：貼上 Webhook 網址 → 開啟 Use webhook → 按 Verify。同一頁把「Allow bot to join group chats」設為啟用，並到 LINE Official Account Manager 關閉「自動回應訊息」。' },
    { done: groups.length > 0, title: '把 Bot 邀請進群組', body: groups.length ? '已加入：' + groups.map(g => esc(g.name)).join('、') : '用手機掃 Bot 的 QR code 加好友，再從群組「邀請」把它加進去。' },
    { done: activity.totalFiles > 0, title: '收到第一個檔案', body: '在群組傳一個檔案試試看，幾秒內就會出現在「檔案」頁。', jump: '/' },
  ];
  const allDone = steps.every(s => s.done);
  $('#checklistCard').classList.toggle('collapsed', allDone);
  $('#checklist').innerHTML = steps.map((s, i) => `
    <li class="${s.done ? 'done' : ''}">
      <span class="dot">${s.done ? '✓' : i + 1}</span>
      <div><b>${s.title}</b>${!s.done && s.body ? `<p>${s.body}</p>` : ''}</div>
    </li>`).join('') + (allDone ? '<li class="all-done">🎉 全部完成！群組裡的檔案會自動收進「檔案」頁。</li>' : '');
}

// ---------- LINE 連線 ----------
function fillLine() {
  $('#secret').value = ''; $('#token').value = '';
  $('#secret').placeholder = settings.channelSecretSet ? `已設定（${settings.channelSecretHint}）— 留空表示不變更` : '貼上 Channel secret';
  $('#token').placeholder = settings.accessTokenSet ? `已設定（${settings.accessTokenHint}）— 留空表示不變更` : '貼上 Channel access token';
  $('#replyOnSave').checked = settings.replyOnSave;
}

async function testLine(quiet) {
  const box = $('#testResult');
  if (!quiet) { box.hidden = false; box.className = 'test-result'; box.textContent = '測試中…'; }
  lineTest = await api('/api/settings/test-line', { method: 'POST' });
  if (lineTest.ok) {
    const b = lineTest.bot, wh = lineTest.webhook;
    box.className = 'test-result ok';
    box.innerHTML = `${b.pictureUrl ? `<img src="${esc(b.pictureUrl)}" alt="">` : ''}
      <div><b>✓ 已連上 ${esc(b.name)}</b> <span class="muted">${esc(b.basicId || '')}</span>
      <div class="muted">${wh ? (wh.endpoint === webhookUrl ? (wh.active ? 'LINE 後台 Webhook 網址正確，且已啟用' : 'Webhook 網址正確，但尚未開啟 Use webhook') : `LINE 後台的 Webhook 網址與本站不同：${esc(wh.endpoint || '（空白）')}`) : ''}</div></div>`;
  } else {
    box.className = 'test-result bad'; box.textContent = '✗ ' + lineTest.error;
  }
  box.hidden = false;
  renderChecklist();
}

$('#saveLine').onclick = async () => {
  const body = {};
  const sec = $('#secret').value.trim(), tok = $('#token').value.trim();
  if (sec) body.channelSecret = sec;
  if (tok) body.accessToken = tok;
  try {
    if (Object.keys(body).length) { await api('/api/settings', { method: 'PUT', body }); toast('已儲存'); }
    settings = await api('/api/settings'); fillLine();
    await testLine();
  } catch (e) { toast(e.message); }
};
$('#testLine').onclick = () => testLine().catch(e => toast(e.message));
$('#replyOnSave').onchange = async e => {
  try { await api('/api/settings', { method: 'PUT', body: { replyOnSave: e.target.checked } }); toast(e.target.checked ? '收到檔案時會在群組回覆' : '不會在群組回覆'); }
  catch (err) { toast(err.message); }
};

// ---------- 分類規則 ----------
let rules;
const iconSelect = v => `<select data-k="icon">${Object.entries(ICONS).map(([k, n]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
function renderRules() {
  $('#catTable').innerHTML = `<div class="rt-head cat"><span>分類（資料夾）名稱</span><span>圖示</span><span>副檔名</span><span></span></div>` +
    rules.categories.map((c, i) => `<div class="rt-row cat" data-i="${i}">
      <input data-k="name" value="${esc(c.name)}" maxlength="30" aria-label="分類名稱">
      ${iconSelect(c.icon)}
      <input data-k="exts" value="${esc(c.exts.join(', '))}" aria-label="副檔名">
      <button class="icon-btn" data-del title="刪除">✕</button></div>`).join('');
  $('#kwTable').innerHTML = `<div class="rt-head kw"><span>關鍵字</span><span>加上標籤</span><span>子資料夾（可空白）</span><span></span></div>` +
    rules.keywordRules.map((k, i) => `<div class="rt-row kw" data-i="${i}">
      <input data-k="keywords" value="${esc(k.keywords.join(', '))}" aria-label="關鍵字">
      <input data-k="tag" value="${esc(k.tag || '')}" maxlength="30" aria-label="標籤">
      <input data-k="folder" value="${esc(k.folder || '')}" maxlength="30" aria-label="子資料夾">
      <button class="icon-btn" data-del title="刪除">✕</button></div>`).join('');
  $('#fallbackName').value = rules.fallbackCategory?.name || '其他';
}
function bindTable(sel, key) {
  $(sel).addEventListener('input', e => {
    const row = e.target.closest('[data-i]'); if (!row) return;
    rules[key][row.dataset.i][e.target.dataset.k] = e.target.value;
  });
  $(sel).addEventListener('change', e => {
    const row = e.target.closest('[data-i]'); if (row && e.target.tagName === 'SELECT') rules[key][row.dataset.i].icon = e.target.value;
  });
  $(sel).addEventListener('click', e => {
    const row = e.target.closest('[data-i]');
    if (row && e.target.closest('[data-del]')) { rules[key].splice(+row.dataset.i, 1); renderRules(); }
  });
}
bindTable('#catTable', 'categories');
bindTable('#kwTable', 'keywordRules');
$('#addCat').onclick = () => { rules.categories.push({ name: '', icon: 'file', exts: [] }); renderRules(); $('#catTable .rt-row:last-child input').focus(); };
$('#addKw').onclick = () => { rules.keywordRules.push({ keywords: [], tag: '', folder: '' }); renderRules(); $('#kwTable .rt-row:last-child input').focus(); };
$('#fallbackName').oninput = e => { rules.fallbackCategory = { name: e.target.value, icon: 'file' }; };

async function saveRules() {
  await api('/api/settings', { method: 'PUT', body: { rules } });
  settings = await api('/api/settings'); rules = structuredClone(settings.rules); renderRules();
}
$('#saveRules').onclick = async () => { try { await saveRules(); toast('規則已儲存，之後收到的檔案會套用新規則'); } catch (e) { toast(e.message); } };
$('#resetRules').onclick = async () => {
  if (!confirm('確定要還原成預設的分類規則？')) return;
  try { await api('/api/settings', { method: 'PUT', body: { rules: null } }); settings = await api('/api/settings'); rules = structuredClone(settings.rules); renderRules(); toast('已還原預設規則'); }
  catch (e) { toast(e.message); }
};
$('#reclassify').onclick = async () => {
  if (!confirm('會先儲存目前的規則，再把所有現有檔案依規則重新搬到對應資料夾。\n\n・手動加的標籤會保留\n・之前手動改過分類的檔案，也會被改回規則判斷的分類\n\n要繼續嗎？')) return;
  try { await saveRules(); const r = await api('/api/reclassify', { method: 'POST' }); toast(`完成，搬移了 ${r.moved} 個檔案`); loadActivity(); }
  catch (e) { toast(e.message); }
};

// ---------- 密碼 ----------
$('#pwForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api('/api/settings/password', { method: 'POST', body: { current: $('#pwCur').value, next: $('#pwNew').value } });
    e.target.reset(); toast('密碼已變更，其他裝置需要重新登入');
  } catch (err) { toast(err.message); }
});

// ---------- 活動紀錄 ----------
async function loadActivity() {
  activity = await api('/api/activity');
  const st = activity.status || {};
  $('#statusLine').textContent = st.lastWebhookAt ? `最後收到 LINE 訊息：${fmtTime(st.lastWebhookAt)}` : '尚未收到任何 LINE 訊息';
  $('#activity').innerHTML = activity.entries.map(e => `<li class="lv-${e.level}"><time>${fmtTime(e.at)}</time><span>${esc(e.msg)}</span></li>`).join('')
    || '<li class="muted">還沒有紀錄。伺服器重新啟動後紀錄會清空。</li>';
  renderChecklist();
}

(async () => {
  settings = await api('/api/settings');
  rules = structuredClone(settings.rules);
  fillLine(); renderRules();
  await loadActivity();
  if (settings.accessTokenSet) testLine(true).catch(() => {});
  setInterval(() => { if (!document.hidden) loadActivity().catch(() => {}); }, 8000);
})().catch(e => toast(e.message));

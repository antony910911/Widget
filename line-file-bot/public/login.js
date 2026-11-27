'use strict';
let setupMode = false;
(async () => {
  const s = await api('/api/session');
  if (s.loggedIn) return (location.href = '/');
  if (!s.configured) {
    setupMode = true;
    $('#title').textContent = '歡迎使用 👋';
    $('#lead').textContent = '第一步：建立管理密碼。之後用這組密碼登入管理介面，至少 6 個字。';
    $('#pw').autocomplete = 'new-password';
    $('#pw2Wrap').hidden = false; $('#pw2').required = true;
    $('#submit').textContent = '建立密碼並開始';
  }
  $('#pw').focus();
})();

$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  $('#err').textContent = '';
  const password = $('#pw').value;
  try {
    if (setupMode) {
      if (password !== $('#pw2').value) throw new Error('兩次輸入的密碼不一樣');
      await api('/api/setup', { method: 'POST', body: { password } });
      location.href = '/settings.html';
    } else {
      await api('/api/login', { method: 'POST', body: { password } });
      location.href = '/';
    }
  } catch (err) { $('#err').textContent = err.message; }
});

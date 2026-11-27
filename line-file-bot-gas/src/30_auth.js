/**
 * 管理介面的登入。網頁版 Apps Script 必須設成「任何人都能存取」LINE 才送得進來，
 * 所以管理功能另外用密碼保護：每個 api* 函式第一個參數都是登入 token。
 */
function hashPassword_(pw, salt) {
  let h = salt + ':' + pw;
  for (let i = 0; i < 1000; i++) h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt));
  return h;
}
function passwordConfigured_() { return Boolean(Props.get('PW_HASH')); }
function checkPassword_(pw) {
  const salt = Props.get('PW_SALT');
  return Boolean(salt) && hashPassword_(String(pw || ''), salt) === Props.get('PW_HASH');
}
function setPassword_(pw) {
  const salt = Utilities.getUuid();
  Props.set('PW_SALT', salt);
  Props.set('PW_HASH', hashPassword_(String(pw), salt));
  Props.setJson('SESSIONS', {}); // 改密碼後所有裝置都要重新登入
}
function newSession_() {
  const now = Date.now();
  const s = Props.getJson('SESSIONS', {});
  Object.keys(s).forEach(k => { if (s[k] < now) delete s[k]; });
  const keys = Object.keys(s).sort((a, b) => s[a] - s[b]);
  while (keys.length >= 20) delete s[keys.shift()];
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  s[token] = now + 30 * 24 * 3600 * 1000;
  Props.setJson('SESSIONS', s);
  return token;
}
function isLoggedIn_(token) {
  if (!token || !passwordConfigured_()) return false;
  const exp = Props.getJson('SESSIONS', {})[token];
  return Boolean(exp && exp > Date.now());
}
function requireAuth_(token) {
  if (!isLoggedIn_(token)) throw new Error('AUTH: 請先登入');
}
/** 登入失敗太多次就暫停 15 分鐘 */
function loginThrottle_(failed) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('login_fail') || 0);
  if (failed === undefined) return n >= 20;
  if (failed) { cache.put('login_fail', String(n + 1), 900); Utilities.sleep(800); } else cache.remove('login_fail');
}

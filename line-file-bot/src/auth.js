import crypto from 'node:crypto';

const COOKIE = 'lfb_session';
const MAX_AGE = 30 * 24 * 3600 * 1000; // 30 天

function sign(key, exp) { return crypto.createHmac('sha256', key).update(String(exp)).digest('base64url'); }

function readCookie(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : '';
}

export function isLoggedIn(req, settings) {
  if (!settings.passwordConfigured) return false;
  const [exp, sig] = readCookie(req).split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const want = Buffer.from(sign(settings.sessionKey, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

export function setSession(req, res, settings) {
  const exp = Date.now() + MAX_AGE;
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  res.cookie(COOKIE, `${exp}.${sign(settings.sessionKey, exp)}`, { httpOnly: true, sameSite: 'lax', secure, maxAge: MAX_AGE, path: '/' });
}

export function clearSession(res) { res.clearCookie(COOKIE, { path: '/' }); }

/** 簡單的登入失敗次數限制：同一 IP 15 分鐘內失敗 10 次就暫停 15 分鐘 */
export function createLoginLimiter() {
  const fails = new Map();
  return {
    blocked(ip) {
      const f = fails.get(ip);
      if (f && Date.now() - f.first > 15 * 60e3) { fails.delete(ip); return false; }
      return f && f.count >= 10;
    },
    fail(ip) {
      const f = fails.get(ip) || { count: 0, first: Date.now() };
      f.count++; fails.set(ip, f);
    },
    ok(ip) { fails.delete(ip); },
  };
}

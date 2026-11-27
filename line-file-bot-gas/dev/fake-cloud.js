// 測試與本機預覽用：假的 LINE / Microsoft Graph / Dropbox 伺服器
const assert = require('node:assert/strict');

const PDF = Buffer.from('%PDF-1.4 test');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

/** 假的 LINE / Microsoft / Dropbox 伺服器 */
function fakeCloud(extraContent = {}, members = {}) {
  const od = { files: new Map(), folders: new Set(['']), polls: 0, uploads: [], chunks: [] };
  const dbx = { files: new Map(), uploads: [] };
  const json = (body, code = 200) => ({ code, body, headers: { 'Content-Type': 'application/json' } });
  const content = {
    m1: ['application/pdf', PDF], m2: ['image/jpeg', JPG], m3: ['application/zip', Buffer.from('PK')],
    m4: ['application/pdf', PDF], m5: ['application/pdf', Buffer.alloc(9 * 1024 * 1024, 1)], m6: ['application/pdf', PDF],
    ...extraContent,
  };
  const handler = (url, opts) => {
    const u = new URL(url);
    const auth = (opts.headers || {}).Authorization;
    // ----- LINE -----
    if (u.host === 'api-data.line.me') {
      if (auth !== 'Bearer line-token') return json({}, 401);
      const id = u.pathname.split('/')[4];
      const [type, body] = content[id];
      return { code: 200, body, headers: { 'Content-Type': type } };
    }
    if (u.host === 'api.line.me') {
      if (auth !== 'Bearer line-token') return json({ message: 'invalid token' }, 401);
      let m;
      if ((m = u.pathname.match(/\/group\/(\w+)\/member\/(\w+)$/))) return json({ displayName: { U1: '王小明', U2: 'Amy', ...members }[m[2]] });
      if (u.pathname.endsWith('/summary')) return json({ groupName: '專案群組' });
      if (u.pathname === '/v2/bot/info') return json({ displayName: '檔案小幫手', basicId: '@abc' });
      if (u.pathname === '/v2/bot/channel/webhook/endpoint') return json({ endpoint: 'https://script.google.com/macros/s/TEST/exec?key=x', active: true });
      if (u.pathname === '/v2/bot/message/reply') return json({});
    }
    // ----- Microsoft -----
    if (u.host === 'login.microsoftonline.com') {
      const body = new URLSearchParams(opts.payload);
      if (u.pathname.endsWith('/devicecode')) return json({ user_code: 'ABCD-EFGH', device_code: 'dev123', verification_uri: 'https://microsoft.com/devicelogin', interval: 5, expires_in: 900 });
      if (body.get('grant_type').includes('device_code')) {
        return ++od.polls < 2 ? json({ error: 'authorization_pending' }, 400) : json({ access_token: 'od-access', refresh_token: 'od-refresh', expires_in: 3600 });
      }
      if (body.get('grant_type') === 'refresh_token') return json({ access_token: 'od-access', refresh_token: 'od-refresh2', expires_in: 3600 });
    }
    if (u.host === 'graph.microsoft.com') {
      assert.equal(auth, 'Bearer od-access');
      const p = decodeURIComponent(u.pathname.replace('/v1.0', ''));
      let m;
      if (p === '/me') return json({ userPrincipalName: 'me@outlook.com' });
      if ((m = p.match(/^\/me\/drive\/root:\/(.+?):\/content$/))) {
        od.uploads.push(m[1]); const id = 'od' + od.files.size;
        od.files.set(id, m[1]);
        return json({ id, name: m[1].split('/').pop(), webUrl: 'https://onedrive.live.com/' + id }, 201);
      }
      if ((m = p.match(/^\/me\/drive\/root:\/(.+?):\/createUploadSession$/))) return json({ uploadUrl: 'https://upload.onedrive.test/s?path=' + encodeURIComponent(m[1]) });
      if ((m = p.match(/^\/me\/drive\/root:\/(.+)$/)) && opts.method === 'get') return od.folders.has(m[1]) ? json({ id: 'F:' + m[1] }) : json({ error: { message: 'nf' } }, 404);
      if (p.endsWith('/children') && opts.method === 'post') {
        const parent = p === '/me/drive/root/children' ? '' : p.replace('/me/drive/items/', '').replace(/\/children$/, '').slice(2);
        const name = JSON.parse(opts.payload).name;
        const full = parent ? parent + '/' + name : name;
        od.folders.add(full);
        return json({ id: 'F:' + full }, 201);
      }
      if ((m = p.match(/^\/me\/drive\/items\/([^/]+)$/))) {
        if (opts.method === 'patch') {
          const patch = JSON.parse(opts.payload); const old = od.files.get(m[1]);
          const dir = patch.parentReference ? patch.parentReference.id.slice(2) : old.split('/').slice(0, -1).join('/');
          const name = patch.name || old.split('/').pop();
          od.files.set(m[1], dir + '/' + name);
          return json({ id: m[1], name, webUrl: 'https://onedrive.live.com/' + m[1] });
        }
        if (opts.method === 'delete') { od.files.delete(m[1]); return { code: 204, body: '' }; }
      }
      if (p.endsWith('/thumbnails/0/medium')) return json({ url: 'https://thumb.onedrive.test/x.jpg' });
    }
    if (u.host === 'upload.onedrive.test') {
      od.chunks.push(opts.headers['Content-Range']);
      const [, , total] = opts.headers['Content-Range'].match(/bytes (\d+-\d+)\/(\d+)/);
      const done = opts.headers['Content-Range'].endsWith('-' + (total - 1) + '/' + total);
      const path = decodeURIComponent(u.searchParams.get('path'));
      if (done) { od.files.set('big', path); return json({ id: 'big', name: path.split('/').pop(), webUrl: 'https://onedrive.live.com/big' }, 201); }
      return json({ nextExpectedRanges: [] }, 202);
    }
    // ----- Dropbox -----
    if (u.host === 'api.dropboxapi.com' && u.pathname === '/oauth2/token') {
      const body = new URLSearchParams(opts.payload);
      if (body.get('grant_type') === 'authorization_code') return body.get('code') === 'good-code' ? json({ access_token: 'dbx-access', refresh_token: 'dbx-refresh', expires_in: 14400 }) : json({ error: 'invalid_grant' }, 400);
      return json({ access_token: 'dbx-access', expires_in: 14400 });
    }
    if (u.host === 'api.dropboxapi.com') {
      assert.equal(auth, 'Bearer dbx-access');
      if (u.pathname === '/2/users/get_current_account') return json({ email: 'me@dropbox.test' });
      if (u.pathname === '/2/files/move_v2') {
        const b = JSON.parse(opts.payload); dbx.files.set(b.from_path, b.to_path);
        return json({ metadata: { id: b.from_path, name: b.to_path.split('/').pop(), path_display: b.to_path } });
      }
      if (u.pathname === '/2/files/delete_v2') { dbx.files.delete(JSON.parse(opts.payload).path); return json({}); }
    }
    if (u.host === 'content.dropboxapi.com' && u.pathname === '/2/files/upload') {
      const raw = opts.headers['Dropbox-API-Arg'];
      assert.ok(/^[\x00-\x7f]*$/.test(raw), 'Dropbox-API-Arg 必須只有 ASCII');
      const arg = JSON.parse(raw);
      const id = 'id:dbx' + dbx.files.size;
      dbx.files.set(id, arg.path); dbx.uploads.push(arg.path);
      return json({ id, name: arg.path.split('/').pop(), path_display: arg.path });
    }
    throw new Error('No fake for ' + opts.method + ' ' + url);
  };
  return { handler, od, dbx };
}


module.exports = { fakeCloud };

/**
 * Dropbox — 需要在 Dropbox App Console 建立一個 App，取得 App key / App secret，步驟見說明文件。
 */
const DBX_API = 'https://api.dropboxapi.com';
const DBX_CONTENT = 'https://content.dropboxapi.com';

/** Dropbox-API-Arg 標頭只能放 ASCII，中文要轉成 \uXXXX */
function dropboxArg_(obj) {
  return JSON.stringify(obj).replace(/[\u007f-￿]/g, c => '\\u' + ('000' + c.charCodeAt(0).toString(16)).slice(-4));
}

registerStorage_({
  id: 'dropbox',
  label: 'Dropbox',
  isReady() { return Boolean(Props.get('DBX_REFRESH')); },
  account() { return Props.get('DBX_ACCOUNT', ''); },

  // ----- 連接 -----
  authUrl(appKey) {
    return 'https://www.dropbox.com/oauth2/authorize?' + formStr_({ client_id: appKey, response_type: 'code', token_access_type: 'offline' });
  },
  connect(appKey, appSecret, code) {
    const r = http_(DBX_API + '/oauth2/token', { method: 'post', contentType: 'application/x-www-form-urlencoded',
      payload: formStr_({ code: code.trim(), grant_type: 'authorization_code', client_id: appKey, client_secret: appSecret }) });
    if (r.code !== 200) throw new Error('Dropbox 連接失敗：' + ((r.json && (r.json.error_description || r.json.error)) || r.code) + '（授權碼只能用一次，失敗請重新取得）');
    Props.set('DBX_KEY', appKey); Props.set('DBX_SECRET', appSecret); Props.set('DBX_REFRESH', r.json.refresh_token);
    CacheService.getScriptCache().put('dbx_access', r.json.access_token, 3000);
    const me = this.rpc('/2/users/get_current_account', null);
    Props.set('DBX_ACCOUNT', (me && (me.email || (me.name && me.name.display_name))) || 'Dropbox');
    return this.account();
  },
  disconnect() { ['DBX_REFRESH', 'DBX_ACCOUNT'].forEach(k => Props.set(k, null)); CacheService.getScriptCache().remove('dbx_access'); },

  // ----- API -----
  accessToken() {
    return oauthAccessToken_('dbx_access', () => {
      const r = http_(DBX_API + '/oauth2/token', { method: 'post', contentType: 'application/x-www-form-urlencoded',
        payload: formStr_({ grant_type: 'refresh_token', refresh_token: Props.get('DBX_REFRESH'), client_id: Props.get('DBX_KEY'), client_secret: Props.get('DBX_SECRET') }) });
      if (r.code !== 200) throw new Error('Dropbox 授權已失效，請到「設定」重新連接');
      return r.json;
    });
  },
  rpc(path, body) {
    const opts = { method: 'post', headers: { Authorization: 'Bearer ' + this.accessToken() } };
    if (body !== null) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
    const r = http_(DBX_API + path, opts);
    if (r.code >= 300) throw new Error('Dropbox 錯誤：' + ((r.json && r.json.error_summary) || r.text || r.code));
    return r.json;
  },
  full(folder, name) { return '/' + joinPath_(rootFolderName_(), folder, name); },
  result(meta, folder) {
    const parent = meta.path_display.split('/').slice(0, -1).join('/');
    return { fileId: meta.id, path: joinPath_(folder, meta.name), url: 'https://www.dropbox.com/home' + encodeURI(parent) + '?preview=' + encodeURIComponent(meta.name) };
  },
  save(blob, folder, name) {
    const r = http_(DBX_CONTENT + '/2/files/upload', {
      method: 'post', contentType: 'application/octet-stream', payload: blob.getBytes(),
      headers: { Authorization: 'Bearer ' + this.accessToken(), 'Dropbox-API-Arg': dropboxArg_({ path: this.full(folder, name), mode: 'add', autorename: true }) },
    });
    if (r.code >= 300) throw new Error('Dropbox 上傳失敗：' + ((r.json && r.json.error_summary) || r.code));
    return this.result(r.json, folder);
  },
  move(rec, folder, name) {
    const r = this.rpc('/2/files/move_v2', { from_path: rec.fileId, to_path: this.full(folder, name), autorename: true });
    return this.result(r.metadata, folder);
  },
  remove(rec) { this.rpc('/2/files/delete_v2', { path: rec.fileId }); },
  thumbnail() { return null; },
});

/** iCloud：Apple 沒有開放 iCloud 雲碟的 API，第三方程式無法寫入，因此只放說明、不能選。 */

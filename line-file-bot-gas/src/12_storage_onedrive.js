/**
 * OneDrive（個人版或公司 / 學校帳號皆可）— 透過 Microsoft Graph API
 * 需要先在 Azure 註冊一個應用程式取得「用戶端識別碼 (Client ID)」，步驟見說明文件。
 * 連接方式使用「裝置代碼登入」：網頁上顯示一組代碼，到 microsoft.com/devicelogin 輸入即可。
 */
const MS_LOGIN = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const MS_GRAPH = 'https://graph.microsoft.com/v1.0';
const MS_SCOPE = 'Files.ReadWrite User.Read offline_access';
const ONEDRIVE_CHUNK = 320 * 1024 * 32; // 10 MB，必須是 320 KB 的倍數

registerStorage_({
  id: 'onedrive',
  label: 'OneDrive',
  isReady() { return Boolean(Props.get('OD_REFRESH') && Props.get('OD_CLIENT_ID')); },
  account() { return Props.get('OD_ACCOUNT', ''); },

  // ----- 連接 -----
  startLogin(clientId) {
    const r = http_(MS_LOGIN + '/devicecode', { method: 'post', contentType: 'application/x-www-form-urlencoded', payload: formStr_({ client_id: clientId, scope: MS_SCOPE }) });
    if (r.code !== 200) throw new Error('無法開始登入：' + ((r.json && r.json.error_description) || r.code) + '。請確認 Client ID 正確，且已開啟「允許公用用戶端流程」');
    return { userCode: r.json.user_code, verificationUri: r.json.verification_uri, deviceCode: r.json.device_code, interval: r.json.interval || 5, expiresIn: r.json.expires_in };
  },
  pollLogin(clientId, deviceCode) {
    const r = http_(MS_LOGIN + '/token', { method: 'post', contentType: 'application/x-www-form-urlencoded',
      payload: formStr_({ client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    if (r.code === 200) {
      Props.set('OD_CLIENT_ID', clientId);
      Props.set('OD_REFRESH', r.json.refresh_token);
      CacheService.getScriptCache().put('od_access', r.json.access_token, 3000);
      const me = this.graph('get', '/me').json || {};
      Props.set('OD_ACCOUNT', me.userPrincipalName || me.mail || me.displayName || 'OneDrive');
      return { status: 'ok', account: this.account() };
    }
    const err = r.json && r.json.error;
    if (err === 'authorization_pending' || err === 'slow_down') return { status: 'pending' };
    return { status: 'error', error: (r.json && r.json.error_description || '登入失敗').split('\r\n')[0] };
  },
  disconnect() { ['OD_REFRESH', 'OD_ACCOUNT', 'OD_ROOT_ID'].forEach(k => Props.set(k, null)); CacheService.getScriptCache().remove('od_access'); },

  // ----- API -----
  accessToken() {
    return oauthAccessToken_('od_access', () => {
      const r = http_(MS_LOGIN + '/token', { method: 'post', contentType: 'application/x-www-form-urlencoded',
        payload: formStr_({ client_id: Props.get('OD_CLIENT_ID'), grant_type: 'refresh_token', refresh_token: Props.get('OD_REFRESH'), scope: MS_SCOPE }) });
      if (r.code !== 200) throw new Error('OneDrive 授權已失效，請到「設定」重新連接（' + ((r.json && r.json.error) || r.code) + '）');
      if (r.json.refresh_token) Props.set('OD_REFRESH', r.json.refresh_token);
      return r.json;
    });
  },
  graph(method, path, body, extra) {
    const opts = Object.assign({ method: method, headers: { Authorization: 'Bearer ' + this.accessToken() } }, extra || {});
    if (body !== undefined && !opts.payload) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
    return http_(path.indexOf('http') === 0 ? path : MS_GRAPH + path, opts);
  },
  check(r, what) {
    if (r.code >= 300) throw new Error('OneDrive ' + what + '失敗：' + ((r.json && r.json.error && r.json.error.message) || r.code));
    return r.json;
  },
  enc(path) { return splitPath_(path).map(encodeURIComponent).join('/'); },
  fullPath(folder) { return joinPath_(rootFolderName_(), folder); },
  ensureFolder(path) {
    // 逐層確認資料夾存在，回傳最後一層的 id
    let parentId = null;
    let cur = '';
    splitPath_(path).forEach(seg => {
      cur = joinPath_(cur, seg);
      let r = this.graph('get', '/me/drive/root:/' + this.enc(cur));
      if (r.code === 404) {
        const parent = parentId ? '/me/drive/items/' + parentId + '/children' : '/me/drive/root/children';
        r = this.graph('post', parent, { name: seg, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' });
        if (r.code === 409) r = this.graph('get', '/me/drive/root:/' + this.enc(cur));
      }
      parentId = this.check(r, '建立資料夾').id;
    });
    return parentId;
  },
  result(item, folder) {
    return { fileId: item.id, path: joinPath_(folder, item.name), url: item.webUrl };
  },
  save(blob, folder, name) {
    const full = joinPath_(this.fullPath(folder), name);
    const bytes = blob.getBytes();
    let item;
    if (bytes.length <= 4 * 1024 * 1024) {
      this.ensureFolder(this.fullPath(folder));
      item = this.check(this.graph('put', '/me/drive/root:/' + this.enc(full) + ':/content?@microsoft.graph.conflictBehavior=rename', undefined,
        { contentType: blob.getContentType() || 'application/octet-stream', payload: bytes }), '上傳');
    } else {
      // 大檔：分段上傳
      this.ensureFolder(this.fullPath(folder));
      const s = this.check(this.graph('post', '/me/drive/root:/' + this.enc(full) + ':/createUploadSession',
        { item: { '@microsoft.graph.conflictBehavior': 'rename' } }), '建立上傳工作');
      for (let start = 0; start < bytes.length; start += ONEDRIVE_CHUNK) {
        const end = Math.min(start + ONEDRIVE_CHUNK, bytes.length);
        const r = http_(s.uploadUrl, { method: 'put', contentType: 'application/octet-stream', payload: bytes.slice(start, end),
          headers: { 'Content-Range': 'bytes ' + start + '-' + (end - 1) + '/' + bytes.length } });
        if (r.code >= 300) throw new Error('OneDrive 分段上傳失敗：' + r.code);
        if (end === bytes.length) item = r.json;
      }
    }
    return this.result(item, folder);
  },
  move(rec, folder, name) {
    const patch = {};
    if (folder !== rec.folder) patch.parentReference = { id: this.ensureFolder(this.fullPath(folder)) };
    if (name !== rec.name) patch.name = name;
    let r = this.graph('patch', '/me/drive/items/' + encodeURIComponent(rec.fileId), patch);
    for (let i = 1; r.code === 409 && i < 50; i++) { patch.name = nextName_(name, i); r = this.graph('patch', '/me/drive/items/' + encodeURIComponent(rec.fileId), patch); }
    return this.result(this.check(r, '搬移'), folder);
  },
  remove(rec) {
    const r = this.graph('delete', '/me/drive/items/' + encodeURIComponent(rec.fileId));
    if (r.code >= 300 && r.code !== 404) this.check(r, '刪除');
  },
  thumbnail(rec) {
    const r = this.graph('get', '/me/drive/items/' + encodeURIComponent(rec.fileId) + '/thumbnails/0/medium');
    return r.code === 200 && r.json ? r.json.url : null;
  },
});

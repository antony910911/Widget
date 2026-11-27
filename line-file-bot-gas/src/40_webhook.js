/** LINE 會把群組裡的每則訊息 POST 到這裡 */
function doPost(e) {
  const ok = ContentService.createTextOutput('ok');
  const key = e && e.parameter && e.parameter.key;
  if (!key || key !== Props.get('WEBHOOK_KEY')) {
    logActivity_('warn', '收到網址 key 不正確的請求，已忽略（LINE 後台的 Webhook 網址要整串複製，包含 ?key=…）');
    return ok;
  }
  let body;
  try { body = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (err) { return ok; }
  Props.set('LAST_WEBHOOK_AT', new Date().toISOString());
  const events = body.events || [];
  if (!events.length) logActivity_('info', '收到 LINE 的 Webhook 驗證請求（Verify）✔');
  events.forEach(ev => {
    try { handleEvent_(ev); } catch (err) { logActivity_('error', '處理失敗：' + err.message); }
  });
  return ok;
}

function rememberGroup_(gid) {
  const groups = Props.getJson('GROUPS', {});
  if (!groups[gid]) {
    let name = '群組';
    try { name = Line.groupName(gid); } catch (e) {}
    groups[gid] = { name: name, since: new Date().toISOString() };
    Props.setJson('GROUPS', groups);
  }
  return groups[gid];
}

const LINE_FILE_TYPES = ['file', 'image', 'video', 'audio'];

function handleEvent_(ev) {
  const src = ev.source || {};
  const gid = src.groupId;
  if (ev.type === 'join' && gid) { logActivity_('info', 'Bot 已加入群組「' + rememberGroup_(gid).name + '」'); return null; }
  if (ev.type === 'leave' && gid) {
    const groups = Props.getJson('GROUPS', {});
    logActivity_('info', 'Bot 已離開群組「' + ((groups[gid] && groups[gid].name) || gid) + '」');
    delete groups[gid]; Props.setJson('GROUPS', groups);
    return null;
  }
  if (ev.type !== 'message' || !ev.message || LINE_FILE_TYPES.indexOf(ev.message.type) < 0) return null;
  const msg = ev.message;

  // LINE 重送時避免重複
  const cache = CacheService.getScriptCache();
  if (cache.get('msg_' + msg.id) || Db.hasMessage(msg.id)) return null;
  cache.put('msg_' + msg.id, '1', 21600);

  if (msg.fileSize && msg.fileSize > MAX_DOWNLOAD_BYTES) {
    logActivity_('warn', '「' + msg.fileName + '」超過 50 MB，Google 版無法下載，已略過');
    if (Props.get('REPLY_ON_SAVE') === 'true' && ev.replyToken) Line.reply(ev.replyToken, '⚠️「' + msg.fileName + '」超過 50 MB，無法自動備份');
    return null;
  }

  const sourceId = src.groupId || src.roomId || src.userId || '';
  let sourceName = src.type === 'room' ? '多人聊天室' : src.type === 'user' ? '一對一聊天' : '群組';
  if (gid) sourceName = rememberGroup_(gid).name;

  // 上傳者名稱（快取 6 小時）
  let uploader = '未知成員';
  if (src.userId) {
    const ck = 'name_' + sourceId + '_' + src.userId;
    uploader = cache.get(ck);
    if (!uploader) {
      try { uploader = Line.senderProfile(src).displayName; cache.put(ck, uploader, 21600); }
      catch (e) { uploader = '成員' + src.userId.slice(-4); }
    }
  }

  const blob = Line.download(msg.id);
  const mime = blob.getContentType() || '';
  let original = msg.type === 'file' && msg.fileName ? msg.fileName : null;
  if (!original) {
    const prefix = { image: '圖片', video: '影片', audio: '語音' }[msg.type];
    const stamp = Utilities.formatDate(new Date(ev.timestamp || Date.now()), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    original = prefix + '_' + stamp + '.' + extFromMime_(mime, { image: 'jpg', video: 'mp4', audio: 'm4a' }[msg.type]);
  }
  const name = sanitizeName_(original);
  const cls = Classifier.classify(name, msg.type);
  const storage = activeStorage_();
  if (!storage.isReady()) throw new Error(storage.label + ' 尚未連接，無法儲存「' + name + '」');
  const saved = storage.save(blob, cls.folder, name);

  const tags = ['@' + uploader, cls.category].concat(cls.tags);
  if (gid) tags.push('群:' + sourceName);
  const rec = Db.add({
    messageId: msg.id, name: saved.path.split('/').pop(), category: cls.category, folder: cls.folder,
    ext: getExt_(name), size: blob.getBytes().length, uploader: uploader, uploaderId: src.userId || '',
    sourceType: src.type || '', source: sourceName, tags: tags.filter((t, i) => tags.indexOf(t) === i),
    uploadedAt: new Date(ev.timestamp || Date.now()).toISOString(),
    storage: storage.id, fileId: saved.fileId, path: saved.path, url: saved.url, mime: mime,
  });
  Props.set('LAST_FILE_AT', new Date().toISOString());
  logActivity_('info', '已收下「' + rec.name + '」→ ' + storage.label + '/' + cls.folder + '（' + uploader + '）');
  if (Props.get('REPLY_ON_SAVE') === 'true' && ev.replyToken) {
    try { Line.reply(ev.replyToken, '📁 已收到「' + rec.name + '」，存到 ' + cls.folder); } catch (e) {}
  }
  return rec;
}

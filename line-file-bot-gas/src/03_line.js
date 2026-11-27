const LINE_API = 'https://api.line.me';
const LINE_DATA_API = 'https://api-data.line.me';

const Line = {
  token() { return Props.get('LINE_TOKEN', ''); },
  call(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ Authorization: 'Bearer ' + this.token() }, opts.headers || {});
    return http_(url, opts);
  },
  json(url) {
    const r = this.call(url);
    if (r.code === 401) throw new Error('LINE 拒絕存取（401）：Channel access token 錯誤或已過期');
    if (r.code >= 300) throw new Error('LINE API 錯誤 ' + r.code);
    return r.json;
  },
  /** 下載訊息內容，回傳 Blob */
  download(messageId) {
    const url = LINE_DATA_API + '/v2/bot/message/' + encodeURIComponent(messageId) + '/content';
    for (let i = 0; i < 8; i++) {
      let r;
      try {
        r = this.call(url, { binary: true });
      } catch (e) {
        if (/size|large|大小|limit/i.test(e.message)) throw new Error('檔案超過 50 MB，Google Apps Script 無法下載');
        throw e;
      }
      if (r.code === 202) { Utilities.sleep(2000 * (i + 1)); continue; } // 影片 / 語音轉檔中
      if (r.code !== 200) throw new Error('下載內容失敗（' + r.code + '）');
      return r.response.getBlob();
    }
    throw new Error('LINE 還在處理這個檔案，稍後仍無法下載');
  },
  senderProfile(src) {
    const uid = encodeURIComponent(src.userId);
    if (src.type === 'group') return this.json(LINE_API + '/v2/bot/group/' + encodeURIComponent(src.groupId) + '/member/' + uid);
    if (src.type === 'room') return this.json(LINE_API + '/v2/bot/room/' + encodeURIComponent(src.roomId) + '/member/' + uid);
    return this.json(LINE_API + '/v2/bot/profile/' + uid);
  },
  groupName(groupId) { return this.json(LINE_API + '/v2/bot/group/' + encodeURIComponent(groupId) + '/summary').groupName; },
  botInfo() { return this.json(LINE_API + '/v2/bot/info'); },
  webhookEndpoint() { return this.json(LINE_API + '/v2/bot/channel/webhook/endpoint'); },
  reply(replyToken, text) {
    this.call(LINE_API + '/v2/bot/message/reply', {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: text }] }),
    });
  },
};

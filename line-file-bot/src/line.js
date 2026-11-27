import crypto from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export function verifySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** token 可以是字串，或回傳字串的函式（金鑰在網頁上修改後不必重新啟動） */
export function createLineClient({ token, apiBase = 'https://api.line.me', dataBase = 'https://api-data.line.me' }) {
  const getToken = typeof token === 'function' ? token : () => token;
  const authHeaders = () => ({ Authorization: `Bearer ${getToken()}` });

  async function getJson(url) {
    const r = await fetch(url, { headers: authHeaders() });
    if (r.status === 401) throw new Error('LINE 拒絕存取（401）：Channel access token 錯誤或已過期');
    if (!r.ok) throw new Error(`LINE API 錯誤 ${r.status}`);
    return r.json();
  }

  return {
    /** 下載訊息內容到 destPath，回傳 {mime, size} */
    async downloadContent(messageId, destPath) {
      const url = `${dataBase}/v2/bot/message/${encodeURIComponent(messageId)}/content`;
      // 影片 / 音訊剛上傳時 LINE 可能還在轉檔，會回 202，稍等重試
      for (let attempt = 0; attempt < 10; attempt++) {
        const r = await fetch(url, { headers: authHeaders() });
        if (r.status === 202) { await sleep(1500 * (attempt + 1)); continue; }
        if (!r.ok) throw new Error(`下載內容失敗 ${r.status}（訊息 ${messageId}）`);
        await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(destPath));
        return { mime: r.headers.get('content-type') || '', size: fs.statSync(destPath).size };
      }
      throw new Error(`內容仍在處理中，已放棄（訊息 ${messageId}）`);
    },

    async downloadExternal(url, destPath) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`外部內容下載失敗 ${r.status}`);
      await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(destPath));
      return { mime: r.headers.get('content-type') || '', size: fs.statSync(destPath).size };
    },

    /** 依訊息來源取得發送者顯示名稱 */
    async getSenderProfile(source) {
      const uid = encodeURIComponent(source.userId);
      let url;
      if (source.type === 'group') url = `${apiBase}/v2/bot/group/${encodeURIComponent(source.groupId)}/member/${uid}`;
      else if (source.type === 'room') url = `${apiBase}/v2/bot/room/${encodeURIComponent(source.roomId)}/member/${uid}`;
      else url = `${apiBase}/v2/bot/profile/${uid}`;
      return getJson(url); // { displayName, userId, pictureUrl }
    },

    async getGroupName(groupId) {
      const j = await getJson(`${apiBase}/v2/bot/group/${encodeURIComponent(groupId)}/summary`);
      return j.groupName;
    },

    /** 測試金鑰用：取得 Bot 基本資料 */
    async getBotInfo() {
      return getJson(`${apiBase}/v2/bot/info`); // { displayName, basicId, pictureUrl, ... }
    },

    /** 取得 LINE 後台目前設定的 webhook 網址與是否啟用 */
    async getWebhookEndpoint() {
      return getJson(`${apiBase}/v2/bot/channel/webhook/endpoint`); // { endpoint, active }
    },

    async reply(replyToken, text) {
      const r = await fetch(`${apiBase}/v2/bot/message/reply`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
      });
      if (!r.ok) throw new Error(`回覆失敗 ${r.status}`);
    },
  };
}

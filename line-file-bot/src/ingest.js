import path from 'node:path';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { extFromMime, getExt, sanitizeFilename } from './classifier.js';
import { placeFile } from './files.js';

const SUPPORTED = new Set(['file', 'image', 'video', 'audio']);

function stamp(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function uploaderTag(name) { return '@' + name; }

/**
 * 處理一個 LINE webhook event：下載檔案 → 分類 → 存檔 → 建立紀錄（含自動標籤）
 */
export async function handleEvent(ev, ctx) {
  const { line, store, classifier, config, log = console } = ctx;
  if (ev.type !== 'message' || !SUPPORTED.has(ev.message?.type)) return null;
  const msg = ev.message;
  if (store.findByMessageId(msg.id)) return null; // webhook 重送時避免重複

  const src = ev.source || {};
  const sourceId = src.groupId || src.roomId || src.userId;

  // 上傳者名稱
  let uploaderName = '未知成員';
  if (src.userId) {
    const key = `user:${sourceId}:${src.userId}`;
    uploaderName = store.getCachedName(key);
    if (!uploaderName) {
      try {
        uploaderName = (await line.getSenderProfile(src)).displayName;
        store.setCachedName(key, uploaderName);
      } catch (e) {
        log.warn?.(`取得成員名稱失敗：${e.message}`);
        uploaderName = '成員' + src.userId.slice(-4);
      }
    }
  }

  // 群組名稱
  let sourceName = src.type === 'user' ? '一對一聊天' : src.type === 'room' ? '多人聊天室' : '群組';
  if (src.type === 'group') {
    const key = `group:${src.groupId}`;
    const cached = store.getCachedName(key);
    if (cached) sourceName = cached;
    else {
      try { sourceName = await line.getGroupName(src.groupId); store.setCachedName(key, sourceName); }
      catch (e) { log.warn?.(`取得群組名稱失敗：${e.message}`); }
    }
  }

  // 下載到暫存
  const tmpDir = path.join(config.storageDir, '.tmp');
  await fsp.mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, crypto.randomUUID());
  let info;
  try {
    if (msg.contentProvider?.type === 'external' && msg.contentProvider.originalContentUrl) {
      info = await line.downloadExternal(msg.contentProvider.originalContentUrl, tmpPath);
    } else {
      info = await line.downloadContent(msg.id, tmpPath);
    }
  } catch (e) {
    await fsp.rm(tmpPath, { force: true });
    throw e;
  }

  // 檔名：檔案訊息有原始檔名；圖片/影片/音訊沒有，用「類型_時間」命名
  let originalName = msg.type === 'file' && msg.fileName ? msg.fileName : null;
  if (!originalName) {
    const prefix = { image: '圖片', video: '影片', audio: '語音' }[msg.type] || '檔案';
    originalName = `${prefix}_${stamp(ev.timestamp || Date.now())}.${extFromMime(info.mime, msg.type === 'image' ? 'jpg' : msg.type === 'video' ? 'mp4' : 'm4a')}`;
  }
  const safeName = sanitizeFilename(originalName);
  const cls = classifier.classify(safeName, msg.type);
  const { relPath, storedName } = await placeFile(config.storageDir, tmpPath, cls.folder, safeName);

  const tags = [uploaderTag(uploaderName), cls.category, ...cls.tags];
  if (src.type === 'group') tags.push('群:' + sourceName);

  const rec = await store.add({
    messageId: msg.id,
    lineType: msg.type,
    originalName,
    storedName,
    path: relPath,
    folder: cls.folder,
    ext: getExt(safeName),
    mime: info.mime,
    size: info.size || msg.fileSize || 0,
    category: cls.category,
    uploader: { id: src.userId || null, name: uploaderName },
    source: { type: src.type, id: sourceId || null, name: sourceName },
    tags: [...new Set(tags)],
    uploadedAt: new Date(ev.timestamp || Date.now()).toISOString(),
  });
  log.info?.(`已存檔：${rec.path}（${uploaderName}）`);

  if (config.replyOnSave && ev.replyToken) {
    line.reply(ev.replyToken, `📁 已收到「${originalName}」，歸類到 ${cls.folder}`).catch(e => log.warn?.(e.message));
  }
  return rec;
}

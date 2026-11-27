import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/** 在 dir 裡找一個不衝突的檔名：報價.pdf → 報價 (1).pdf */
export function uniqueName(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 1; fs.existsSync(path.join(dir, candidate)); i++) candidate = `${base} (${i})${ext}`;
  return candidate;
}

/** 確保相對路徑留在 root 底下 */
export function resolveInside(root, rel) {
  const abs = path.resolve(root, rel);
  const r = path.resolve(root);
  if (abs !== r && !abs.startsWith(r + path.sep)) throw new Error('路徑不合法');
  return abs;
}

/** 把暫存檔放進 <root>/<folder>/，回傳相對路徑 */
export async function placeFile(root, tmpPath, folder, filename) {
  const dir = resolveInside(root, folder);
  await fsp.mkdir(dir, { recursive: true });
  const finalName = uniqueName(dir, filename);
  const dest = path.join(dir, finalName);
  await moveFile(tmpPath, dest);
  return { relPath: path.relative(root, dest).split(path.sep).join('/'), storedName: finalName };
}

export async function moveFile(src, dest) {
  try {
    await fsp.rename(src, dest);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e; // 跨磁碟
    await fsp.copyFile(src, dest);
    await fsp.unlink(src);
  }
}

/** 刪除檔案後順手移除空的資料夾（不刪 root 本身） */
export async function removeEmptyParents(root, dir) {
  const r = path.resolve(root);
  let d = path.resolve(dir);
  while (d.startsWith(r + path.sep)) {
    try {
      if ((await fsp.readdir(d)).length) break;
      await fsp.rmdir(d);
    } catch { break; }
    d = path.dirname(d);
  }
}

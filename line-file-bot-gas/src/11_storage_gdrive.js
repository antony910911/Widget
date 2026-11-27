/** Google 雲端硬碟：直接用你自己的 Google 帳號，不需要任何設定 */
registerStorage_({
  id: 'gdrive',
  label: 'Google 雲端硬碟',
  isReady() { return true; },
  account() { try { return Session.getEffectiveUser().getEmail(); } catch (e) { return ''; } },

  root() {
    const id = Props.get('GDRIVE_ROOT_ID');
    if (id) {
      try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {}
    }
    const f = DriveApp.createFolder(rootFolderName_());
    Props.set('GDRIVE_ROOT_ID', f.getId());
    return f;
  },
  folder(path) {
    let f = this.root();
    splitPath_(path).forEach(seg => {
      const it = f.getFoldersByName(seg);
      f = it.hasNext() ? it.next() : f.createFolder(seg);
    });
    return f;
  },
  unique(folder, name) {
    let n = name;
    for (let i = 1; folder.getFilesByName(n).hasNext(); i++) n = nextName_(name, i);
    return n;
  },
  save(blob, folder, name) {
    const f = this.folder(folder);
    const n = this.unique(f, name);
    blob.setName(n);
    const file = f.createFile(blob);
    return { fileId: file.getId(), path: joinPath_(folder, n), url: file.getUrl() };
  },
  clash(folder, name, selfId) {
    const it = folder.getFilesByName(name);
    while (it.hasNext()) if (it.next().getId() !== selfId) return true;
    return false;
  },
  move(rec, folder, name) {
    const file = DriveApp.getFileById(rec.fileId);
    const f = this.folder(folder);
    if (folder !== rec.folder) file.moveTo(f);
    let n = name;
    for (let i = 1; this.clash(f, n, file.getId()); i++) n = nextName_(name, i);
    if (n !== file.getName()) file.setName(n);
    return { fileId: file.getId(), path: joinPath_(folder, n), url: file.getUrl() };
  },
  remove(rec) { DriveApp.getFileById(rec.fileId).setTrashed(true); },
  thumbnail(rec) {
    const blob = DriveApp.getFileById(rec.fileId).getThumbnail();
    return blob ? 'data:' + (blob.getContentType() || 'image/png') + ';base64,' + Utilities.base64Encode(blob.getBytes()) : null;
  },
  renameRoot(name) { this.root().setName(name); },
});

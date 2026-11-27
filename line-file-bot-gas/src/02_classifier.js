const Classifier = {
  categoryList(rules) {
    rules = rules || getRules_();
    return rules.categories.map(c => ({ name: c.name, icon: c.icon })).concat([{ name: rules.fallbackCategory.name, icon: 'file' }]);
  },
  iconFor(category, rules) {
    const c = this.categoryList(rules).filter(x => x.name === category)[0];
    return c ? c.icon : 'file';
  },
  /** @returns {{category, icon, folder, tags}} */
  classify(filename, lineType, rules) {
    rules = rules || getRules_();
    const ext = getExt_(filename);
    let cat = rules.categories.filter(c => c.exts.indexOf(ext) >= 0)[0];
    if (!cat) {
      const byType = { image: '圖片', video: '影片', audio: '音訊' }[lineType];
      cat = rules.categories.filter(c => c.name === byType)[0] || rules.fallbackCategory;
    }
    const lower = String(filename || '').toLowerCase();
    const tags = [];
    let sub = null;
    rules.keywordRules.forEach(r => {
      if (r.keywords.some(k => lower.indexOf(String(k).toLowerCase()) >= 0)) {
        if (r.tag && tags.indexOf(r.tag) < 0) tags.push(r.tag);
        if (!sub && r.folder) sub = r.folder;
      }
    });
    const folder = sub ? sanitizeFolder_(cat.name) + '/' + sanitizeFolder_(sub) : sanitizeFolder_(cat.name);
    return { category: cat.name, icon: cat.icon || 'file', folder: folder, tags: tags };
  },
};

const ICON_TYPES = ['doc', 'sheet', 'slide', 'image', 'video', 'audio', 'archive', 'design', 'code', 'file'];

function validateRules_(r) {
  const clean = (s, max) => String(s == null ? '' : s).trim().slice(0, max || 40);
  const list = (v, max) => (Array.isArray(v) ? v : String(v == null ? '' : v).split(/[,，、\s]+/)).map(x => clean(x, max)).filter(Boolean);
  const bad = /[\\/:*?"<>|]/g;
  const seen = {};
  const categories = (r.categories || []).map(c => ({
    name: clean(c.name, 30).replace(bad, ''),
    icon: ICON_TYPES.indexOf(c.icon) >= 0 ? c.icon : 'file',
    exts: list(c.exts, 12).map(e => e.replace(/^\./, '').toLowerCase()).filter((e, i, a) => a.indexOf(e) === i),
  })).filter(c => c.name && !seen[c.name] && (seen[c.name] = true));
  if (!categories.length) throw new Error('至少要有一個分類');
  const fb = clean(r.fallbackCategory && r.fallbackCategory.name, 30).replace(bad, '') || '其他';
  if (seen[fb]) throw new Error('「' + fb + '」不能同時是一般分類和未分類的預設資料夾');
  const keywordRules = (r.keywordRules || []).map(k => {
    const o = { keywords: list(k.keywords), tag: clean(k.tag, 30).replace(/,/g, '') };
    const f = clean(k.folder, 30).replace(bad, '');
    if (f) o.folder = f;
    return o;
  }).filter(k => k.keywords.length && (k.tag || k.folder));
  return { categories: categories, fallbackCategory: { name: fb, icon: 'file' }, keywordRules: keywordRules };
}

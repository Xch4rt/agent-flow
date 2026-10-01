export function slugify(title, options = {}) {
  if (typeof title !== 'string') throw new TypeError('title must be a string');
  const sep = options.separator ?? '-';
  const max = options.maxLength ?? 60;
  const words = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let out = '';
  for (const w of words) {
    const next = out ? `${out}${sep}${w}` : w;
    if (next.length > max) { if (!out) out = w.slice(0, max); break; }
    out = next;
  }
  return out;
}

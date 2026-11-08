import { createHash } from 'node:crypto';

export function computedTree(entries) {
  const directories = new Map(), members = [];
  for (const entry of entries) {
    const [name, ...remaining] = entry.path.split('/');
    if (!remaining.length) members.push({ name, mode: entry.mode, blob: entry.blob });
    else { if (!directories.has(name)) directories.set(name, []); directories.get(name).push({ ...entry, path: remaining.join('/') }); }
  }
  for (const [name, children] of directories) members.push({ name, mode: '40000', blob: computedTree(children) });
  members.sort((left, right) => Buffer.compare(Buffer.from(left.name + (left.mode === '40000' ? '/' : '')), Buffer.from(right.name + (right.mode === '40000' ? '/' : ''))));
  const bytes = Buffer.concat(members.map(entry => Buffer.concat([Buffer.from(`${entry.mode} ${entry.name}\0`), Buffer.from(entry.blob, 'hex')])));
  return createHash('sha1').update(`tree ${bytes.length}\0`).update(bytes).digest('hex');
}

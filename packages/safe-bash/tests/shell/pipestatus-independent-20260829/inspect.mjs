import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const own = 'tests/shell/pipestatus-independent-20260829';
const author = 'tests/shell/pipestatus-author-20260829';
const deadline = fs.lstatSync(`${own}/raw/startup.stdout`).birthtimeMs + 1200000;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function read(file, maximum = 4194304) {
  if (Date.now() > deadline) throw Error('DEADLINE');
  const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw Error(`TYPE:${file}`);
  const bytes = fs.readFileSync(file); if (bytes.length !== stat.size) throw Error('SIZE'); return bytes;
}
const tree = read(`${own}/raw/author-tree.nul`).toString().split('\0').filter(Boolean).map(row => {
  const [meta, file] = row.split('\t'); const [mode, type, blob, size] = meta.trim().split(/ +/); return { file, mode, type, blob, size: Number(size) };
});
const selected = tree.filter(row => (path.dirname(row.file) === author || path.dirname(row.file) === `${author}/corrected-v2`) && /\.(md|json|mjs)$/.test(row.file));
if (selected.length > 64) throw Error('MEMBER_CAP');
fs.mkdirSync(`${own}/source-view`, { mode: 0o700 }); const identities = []; let total = 0;
for (const row of selected) {
  const bytes = read(row.file); total += bytes.length; if (total > 12582912) throw Error('TEXT_CAP');
  const blob = crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
  if (row.type !== 'blob' || row.size !== bytes.length || row.blob !== blob) throw Error(`BLOB:${row.file}`);
  const relative = row.file.slice(author.length + 1); const target = `${own}/source-view/${relative}`;
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 }); fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
  identities.push({ ...row, sha256: hash(bytes), copied: target });
  if (relative === 'corrected-v2/HANDOFF.md') console.log(bytes.toString());
}
fs.writeFileSync(`${own}/INSPECTED.json`, JSON.stringify({ identities, total, deadline }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log('FILES ' + JSON.stringify(identities.map(row => ({ file: row.file, size: row.size, sha256: row.sha256 }))));

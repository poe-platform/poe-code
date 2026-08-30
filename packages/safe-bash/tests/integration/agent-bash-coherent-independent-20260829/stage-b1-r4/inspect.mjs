import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const own = 'tests/integration/agent-bash-coherent-independent-20260829/stage-b1-r4';
const author = 'tests/integration/agent-bash-coherent-author-20260829/stage-b1-r4';
const deadline = fs.lstatSync(`${own}/raw/startup.stdout`).birthtimeMs + 720000;
const digest = (algorithm, bytes) => crypto.createHash(algorithm).update(bytes).digest('hex');
function raw(file, maximum = 4194304) {
  if (Date.now() > deadline) throw Error('DEADLINE');
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw Error(`TYPE:${file}`);
  const bytes = fs.readFileSync(file);
  if (bytes.length !== stat.size) throw Error(`SIZE:${file}`);
  return { bytes, stat };
}
const all = [];
for (const filename of ['source-tree.nul', 'evidence-tree.nul']) {
  const value = raw(`${own}/raw/${filename}`);
  for (const row of value.bytes.toString('utf8').split('\0').filter(Boolean)) {
    const [meta, file] = row.split('\t'); const [mode, type, blob, size] = meta.trim().split(/ +/);
    all.push({ file, mode, type, blob, size: Number(size), tree: filename });
  }
}
const selected = all.filter(row => row.file.startsWith(`${author}/`) && !row.file.includes('/raw/') && /\.(json|md|mjs)$/.test(row.file));
const seen = new Set(); const authenticated = [];
fs.mkdirSync(`${own}/source-view`, { mode: 0o700 });
let total = 0;
for (const row of selected.reverse()) {
  if (seen.has(row.file)) continue; seen.add(row.file);
  if (seen.size > 48) throw Error('FILE_CAP');
  const { bytes, stat } = raw(row.file);
  total += bytes.length; if (total > 8388608) throw Error('TEXT_CAP');
  const blob = digest('sha1', Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]));
  if (row.type !== 'blob' || bytes.length !== row.size || blob !== row.blob) throw Error(`BLOB:${row.file}`);
  const hash = digest('sha256', bytes);
  const target = `${own}/source-view/${path.basename(row.file)}`;
  fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
  authenticated.push({ ...row, sha256: hash, liveMode: stat.mode & 511, copied: target });
  if (row.file.endsWith('/HANDOFF.json')) console.log(bytes.toString('utf8'));
}
fs.writeFileSync(`${own}/INSPECTION.json`, JSON.stringify({ at: new Date().toISOString(), deadline, total, files: authenticated }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log('FILES ' + JSON.stringify(authenticated.map(row => ({ path: row.file, bytes: row.size, sha256: row.sha256 }))));

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const own = path.resolve('tests/compatibility/bash-pipestatus-typed-native-reference-20260829/actual-run-v2');
const root = '/private/tmp/safe-bash-pipestatus-typed-observations-20260829-v1';
const deadline = Math.min(fs.lstatSync(`${own}/raw/startup.stdout`).birthtimeMs + 600000, Date.parse('2026-08-29T15:03:40.912Z'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inventory = []; let total = 0;
const archive = `${own}/native-artifacts`;
function guard() { if (Date.now() > deadline) throw Error('PHASE_PUBLICATION_DEADLINE'); }
function save(file, bytes) {
  guard(); const descriptor = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  guard();
}
guard(); fs.mkdirSync(archive, { mode: 0o700 });
function copy(relative = '') {
  for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
    guard(); const item = path.join(relative, name); const source = path.join(root, item); const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink() || inventory.length > 4096 || stat.uid !== process.getuid()) throw Error('ARTIFACT_AUTHORITY');
    if (stat.isDirectory()) { inventory.push({ path: item, type: 'directory', mode: stat.mode & 511 }); fs.mkdirSync(path.join(archive, item), { mode: 0o700 }); copy(item); }
    else {
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1048576 || (total += stat.size) > 33554432) throw Error('ARTIFACT_CAP');
      const bytes = fs.readFileSync(source); const after = fs.lstatSync(source);
      if (bytes.length !== stat.size || after.ino !== stat.ino || after.mtimeMs !== stat.mtimeMs) throw Error('ARTIFACT_RACE');
      const target = path.join(archive, item + '.data'); save(target, bytes);
      inventory.push({ path: item, type: 'file', mode: stat.mode & 511, bytes: bytes.length, sha256: hash(bytes), copiedAs: path.relative(own, target) });
    }
  }
}
copy();
function data(relative) {
  const row = inventory.find(item => item.path === relative && item.type === 'file');
  if (!row) return null;
  const bytes = fs.readFileSync(path.join(own, row.copiedAs));
  if (hash(bytes) !== row.sha256) throw Error('COPY_HASH'); return bytes;
}
const resultBytes = data('RESULTS.json');
const results = resultBytes ? JSON.parse(resultBytes) : null;
const observations = [];
for (const id of ['P19', 'P20', 'P21', 'P22', 'P23', 'P24']) {
  const rowBytes = data(`${id}.json`);
  if (!rowBytes) { observations.push({ id, status: 'UNRUN_OR_UNPUBLISHED' }); continue; }
  const row = JSON.parse(rowBytes); const channels = {};
  for (const channel of ['stdout', 'stderr']) {
    const files = inventory.filter(item => item.type === 'file' && item.path.startsWith(`captures/${id}/`) && path.basename(item.path).includes(channel));
    channels[channel] = files.map(file => { const bytes = data(file.path); return { path: file.path, bytes: bytes.length, sha256: hash(bytes), base64: bytes.toString('base64'), text: bytes.toString('utf8') }; });
  }
  observations.push({ id, status: row.status, retired: row.retired, stop: row.stop, regularCaptureCompletion: row.regularCaptureCompletion, channels, lifecycle: row });
}
const manifest = { schema: 'typed6-native-observations-v2', at: new Date().toISOString(), phaseDeadline: deadline, source: 'e10e371dc9c70583681add9c1747c85a710b1f59', binding: '32ceae3a52c52e9cb23f327801c1d1b80238143c', observations, results, inventory, rawBytes: total, oldPrelaunchHold: 'e66b4440fbfdb8b03b167f2402a6a9a77dbbfb1c unchanged', qualifiedMeaning: 'local Bash3.2.57 observations, not expected goldens/parity passes or policy selection; no repeat version probe', processMeaning: 'managed observations only; four source-stage reservations unobserved; owner retirement additionally requires exec tool completion' };
save(`${own}/OBSERVATIONS.json`, Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
console.log(JSON.stringify({ at: manifest.at, phaseDeadline: deadline, completed: results?.completed, halted: results?.halted, rawBytes: total, ledger: results?.ledger, observations: observations.map(({ lifecycle, ...rest }) => rest) }, null, 2));

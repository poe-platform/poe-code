import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const own = path.resolve('tests/shell/pipestatus-independent-20260829');
const author = path.resolve('tests/shell/pipestatus-author-20260829/corrected-v2');
const deadline = fs.lstatSync(`${own}/raw/startup.stdout`).birthtimeMs + 1200000;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const records = []; let total = 0;
function read(file, pin, maximum = 4194304) {
  if (Date.now() > deadline) throw Error('DEADLINE');
  const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw Error(`TYPE:${file}`);
  const bytes = fs.readFileSync(file); total += bytes.length; if (total > 33554432) throw Error('READ_CAP');
  const digest = hash(bytes); if (bytes.length !== stat.size || (pin && (bytes.length !== pin.bytes || digest !== pin.sha256))) throw Error(`HASH:${file}`);
  records.push({ path: file, bytes: bytes.length, sha256: digest, mode: stat.mode & 511 }); return bytes;
}
const seal = JSON.parse(read(`${author}/SEAL.json`, { bytes: 215132, sha256: 'c590f60ab8f53c5988056087257e2ed8564ef0db5e256ca4a7d836fa88fce718' }));
if (seal.sources.length !== 307) throw Error('SOURCE_COUNT');
fs.mkdirSync(`${own}/frozen-source`, { mode: 0o700 });
const selected = ['src/shell/pipestatus.ts', 'src/shell/runtime.ts', 'src/shell/shell.ts', 'src/shell/arrays/state.ts', 'src/shell/arrays/bindings.ts', 'src/shell/arrays/ledger.ts'];
for (const row of seal.sources) {
  if (row.path.split('/').includes('AGENTS.md')) throw Error('INSTRUCTION_MEMBER');
  const bytes = read(path.join(seal.candidate, row.path), row);
  const blob = crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
  if (blob !== row.blob || (fs.lstatSync(path.join(seal.candidate, row.path)).mode & 511) !== parseInt(row.mode.slice(-3), 8)) throw Error(`BLOB_MODE:${row.path}`);
  if (selected.includes(row.path)) fs.writeFileSync(`${own}/frozen-source/${path.basename(row.path)}`, bytes, { flag: 'wx', mode: 0o600 });
}
const closure = JSON.parse(read(`${author}/LOADED-CLOSURE.json`, { bytes: 1027, sha256: 'd470219838507995d4dd902d87340014a4ed4b161ef200d8c49ed4e339291b9e' }));
for (const row of closure) read(row.path, row);
const packageBytes = read(`${author}/PACKAGE.json`, { bytes: 197547, sha256: '55bfb3ac054fc7525a2127487ce90e42dd51e3c281561739e7d50113b6aa546c' });
const pack = JSON.parse(packageBytes);
console.log('PACKAGE_FIELDS ' + JSON.stringify(Object.fromEntries(Object.entries(pack).filter(([key, value]) => !Array.isArray(value)))));
for (const row of seal.fixtures) {
  const bytes = read(row.path, row);
  if (row.path.endsWith('/host-protocols.ts')) fs.writeFileSync(`${own}/frozen-source/host-protocols.ts.data`, bytes, { flag: 'wx', mode: 0o600 });
}
const runner = read(`${author}/runner.mjs`, { bytes: 19242, sha256: '59d08a996a3600a0644e8531a9a49adbe58b8d968f91816ce90def7fda6c8609' }).toString();
const begin = runner.indexOf('const groups = ['); const end = runner.indexOf('\n];', begin) + 3;
if (begin < 0 || end < begin) throw Error('GROUP_REGION');
const groupBytes = Buffer.from(runner.slice(begin, end));
if (hash(groupBytes) !== seal.groupBodySha256) throw Error('GROUP_BODY_HASH');
fs.writeFileSync(`${own}/author-groups.mjs.data`, groupBytes, { flag: 'wx', mode: 0o600 });
const changed = seal.sources.filter(row => row.blob !== row.baseBlob);
const retained = seal.sources.filter(row => row.path.includes('regex-execution/ere/') || /(?:arrays\/bindings|arrays\/ledger|shell\/parser|shell\/arithmetic|contracts\/|src\/index)/.test(row.path));
const result = { at: new Date().toISOString(), deadline, candidate: seal.candidate, sourceCount: seal.sources.length, changed, retained, closure, groupBodySha256: hash(groupBytes), fixtures: seal.fixtures, records, totalReadBytes: total };
fs.writeFileSync(`${own}/SOURCE-ADMISSION.json`, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log('SOURCE ' + JSON.stringify({ at: result.at, deadline, sourceCount: 307, changed, closure, groupBodySha256: result.groupBodySha256, totalReadBytes: total }));

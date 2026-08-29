import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repo = '/Users/kjopek/Workspace/safe-bash';
const parent = path.join(repo, 'tests/shell/pipestatus-author-20260829');
const own = path.join(parent, 'corrected-v2');
const work = '/private/tmp/safe-bash-pipestatus-corrected';
const candidate = path.join(work, 'candidate');
const sourceCommit = '43050e861bfeb6dcc8c3e97784b80ce18dc8f793';
const transportCommit = '46611a5b67ad7af276154421ac7f50dd536ec570';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const gitHash = (kind, value) => crypto.createHash('sha1').update(`${kind} ${value.length}\0`).update(value).digest('hex');
function read(filename, maximum = 4 * 1024 * 1024) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.size > maximum) throw new Error(`regular/size ${filename}`);
  const value = fs.readFileSync(filename);
  if (value.length !== stat.size) throw new Error('size drift');
  return value;
}
function binding(filename) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.size > 128 * 1024 * 1024) throw new Error('tool admission');
  const descriptor = fs.openSync(filename, 'r'); const buffer = Buffer.alloc(65536);
  const digest = crypto.createHash('sha256'); let size = 0;
  try { for (;;) { const count = fs.readSync(descriptor, buffer, 0, buffer.length, null); if (!count) break; digest.update(buffer.subarray(0, count)); size += count; } }
  finally { fs.closeSync(descriptor); }
  if (size !== stat.size) throw new Error('tool size drift');
  return { path: filename, size, mode: stat.mode & 0o777, sha256: digest.digest('hex') };
}
const save = (name, value) => fs.writeFileSync(path.join(own, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const oldBytes = read(path.join(parent, 'SEAL.json'));
if (hash(oldBytes) !== 'ac0a0b3066a9e89667336cb9f3012fd7896abc9d59d1a53a47669a59336b0994') throw new Error('old seal authentication');
const old = JSON.parse(oldBytes);
const baseBytes = read(path.join(repo, 'tests/compatibility/bash-ere-runtime-integration-author-20260829/rebind-v1/SEAL.json'));
if (hash(baseBytes) !== 'b3a3844213fe34017bb4b413bafda2433fd52a0d9165aed5810b01db245dfe95') throw new Error('base manifest authentication');
const base = JSON.parse(baseBytes);
const transport = base.sources.filter(row => row.path.includes('/ere/transport/'));
if (transport.length !== 7) throw new Error('transport membership');
const selected = [
  { path: 'src/shell/runtime.ts', revision: sourceCommit },
  { path: 'src/shell/pipestatus.ts', revision: sourceCommit },
  { path: 'src/shell/arithmetic-parameters.ts', revision: 'ffac894aa98b8cd98476b8ea109ef2e2425c2a07' },
  ...transport.map(row => ({ path: row.path, revision: transportCommit })),
];
fs.appendFileSync(path.join(work, 'roles.log'), 'prepare child: scoped git blob batch\n');
const acquired = spawnSync('/usr/bin/git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', 'cat-file', '--batch'], {
  cwd: repo, input: selected.map(row => `${row.revision}:${row.path}\n`).join(''), encoding: null, timeout: 15000, maxBuffer: 4 * 1024 * 1024,
});
fs.writeFileSync(path.join(own, 'GIT.stderr'), acquired.stderr);
save('GIT.json', { status: acquired.status, signal: acquired.signal, pid: acquired.pid, error: acquired.error?.message, rows: selected.length, synchronousReturn: true });
if (acquired.error || acquired.signal || acquired.status !== 0) throw new Error('Git acquisition/retirement');
const stored = new Map(); let cursor = 0;
for (const row of selected) {
  const end = acquired.stdout.indexOf(10, cursor);
  const [blob, kind, rawSize] = acquired.stdout.subarray(cursor, end).toString('ascii').split(' ');
  const size = Number(rawSize); cursor = end + 1;
  if (kind !== 'blob' || !Number.isSafeInteger(size) || size < 1 || size > 1024 * 1024) throw new Error('blob header');
  const content = acquired.stdout.subarray(cursor, cursor + size);
  if (content.length !== size || gitHash('blob', content) !== blob || acquired.stdout[cursor + size] !== 10) throw new Error('blob bytes');
  cursor += size + 1; stored.set(row.path, { ...row, content, blob });
}
if (cursor !== acquired.stdout.length) throw new Error('extra acquisition bytes');
fs.mkdirSync(candidate);
const sources = [];
for (const row of old.sources) {
  if (path.isAbsolute(row.path) || row.path.split('/').some(part => part === '..' || part === 'AGENTS.md')) throw new Error('source path');
  const previous = read(path.join(old.candidate, row.path));
  if (hash(previous) !== row.sha256 || previous.length !== row.bytes || gitHash('blob', previous) !== row.blob) throw new Error('old source drift');
  const replacement = stored.get(row.path);
  const content = replacement?.content ?? previous;
  if (row.path !== 'src/shell/pipestatus.ts' && !content.equals(previous)) throw new Error(`unexpected foreign source difference ${row.path}`);
  const original = base.sources.find(entry => entry.path === row.path);
  const destination = path.join(candidate, row.path);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content, { flag: 'wx', mode: Number.parseInt(row.mode, 8) & 0o777 });
  sources.push({ path: row.path, bytes: content.length, sha256: hash(content), blob: gitHash('blob', content), mode: row.mode, revision: replacement?.revision ?? original?.revision ?? row.origin, baseBlob: original?.blob ?? null, baseRevision: original?.revision ?? null });
}
const helper = sources.find(row => row.path === 'src/shell/pipestatus.ts');
if (helper.sha256 !== 'f63902e8be1774de81973d4477f8317a6045b637b40bddbed025e2f43bb72eb1') throw new Error('corrected helper identity');
for (const row of old.tools) {
  const actual = binding(row.path);
  if (actual.sha256 !== row.sha256 || actual.size !== row.size || actual.mode !== row.mode) throw new Error('tool binding');
}
const originalPure = read(path.join(parent, 'pure.mjs'));
const pureBinding = old.fixtures.find(row => row.path.endsWith('/pure.mjs'));
if (hash(originalPure) !== pureBinding.sha256) throw new Error('original group fixture drift');
let runner = originalPure.toString('utf8').replace(`const own = '${parent}';`, `const own = '${own}';`).replace("const work = '/private/tmp/safe-bash-pipestatus-author-fresh';", `const work = '${work}';`);
const groupStart = 'const groups = ['; const groupEnd = '\nfor (const [id, body] of groups)';
const groupBytes = text => text.slice(text.indexOf(groupStart), text.indexOf(groupEnd));
if (groupBytes(runner) !== groupBytes(originalPure.toString('utf8'))) throw new Error('group bodies changed');
const originalPublisher = read(path.join(parent, 'publish.mjs'));
const publishPins = read(path.join(parent, 'PUBLICATION-PRESEAL.sha256')).toString('utf8');
if (!publishPins.includes(hash(originalPublisher) + ' ')) throw new Error('original DATA packaging helper binding');
let publish = originalPublisher.toString('utf8').replace(/^import .*;\n/gmu, '');
publish = publish.replace(`const own = path.join(repo, 'tests/shell/pipestatus-author-20260829');`, `const own = '${own}';`).replace("const work = '/private/tmp/safe-bash-pipestatus-author-fresh';", `const work = '${work}';`);
publish = publish.replace("if (name.startsWith('pipestatus-proof-types.')) continue;", "if (name.startsWith('pipestatus-proof-types.') || name.startsWith('pipestatus-host-proof.')) continue;");
publish = publish.replaceAll("path.join(repo, 'src/shell/", "path.join(seal.candidate, 'src/shell/");
publish = publish.replaceAll('correctedG18SourceIncluded: false', 'correctedG18SourceIncluded: true').replaceAll('compiledCorrection: false', 'compiledCorrection: true').replaceAll('correctedSourceUncompiled: true', 'correctedSourceUncompiled: false');
publish = publish.replace("strictBuildOfCorrection: 'NOT RUN: one compiler authorization consumed', pureCorrectionReplay: 'NOT RUN'", "strictBuildOfCorrection: 'see BUILD.json', pureCorrectionReplay: 'see PURE-RESULTS.json'");
publish = publish.replaceAll('original-build-artifact.tgz', 'corrected-build-artifact.tgz');
publish = publish.replace('scratchBytes > 512 * 1024 * 1024 || roles.length > 80', 'scratchBytes > 256 * 1024 * 1024 || roles.length > 36');
runner = "import zlib from 'node:zlib';\n" + runner + '\nawait (async () => {\n' + publish + '\n})();\n';
fs.writeFileSync(path.join(own, 'runner.mjs'), runner, { flag: 'wx' });
fs.copyFileSync(path.join(parent, 'types.ts'), path.join(candidate, 'src/shell/pipestatus-proof-types.ts'));
fs.copyFileSync(path.join(own, 'host-protocols.ts'), path.join(candidate, 'src/shell/pipestatus-host-proof.ts'));
const treeRoot = new Map();
for (const row of sources) {
  const parts = row.path.split('/'); let directory = treeRoot;
  for (const part of parts.slice(0, -1)) { if (!directory.has(part)) directory.set(part, new Map()); directory = directory.get(part); }
  directory.set(parts.at(-1), row);
}
function tree(directory) {
  const records = [...directory].map(([name, entry]) => ({ name, directory: entry instanceof Map, entry }));
  records.sort((left, right) => Buffer.compare(Buffer.from(left.name + (left.directory ? '/' : '')), Buffer.from(right.name + (right.directory ? '/' : ''))));
  const content = Buffer.concat(records.flatMap(row => [Buffer.from(`${row.directory ? '40000' : row.entry.mode} ${row.name}\0`), Buffer.from(row.directory ? tree(row.entry) : row.entry.blob, 'hex')]));
  return gitHash('tree', content);
}
const compilerArgs = old.compiler.args.map(value => value.startsWith(old.candidate) ? candidate + value.slice(old.candidate.length) : value);
const fixtures = ['prepare.mjs', 'runner.mjs', 'host-protocols.ts', 'PRESEAL.md'].map(name => binding(path.join(own, name)));
save('SEAL.json', { sourceCommit, baseline: base.selectedTree, projectionTree: tree(treeRoot), count: sources.length, sources, tools: old.tools, candidate, compiler: { ...old.compiler, args: compilerArgs }, fixtures, validationOnly: ['pipestatus-proof-types.ts', 'pipestatus-host-proof.ts'], pins: { PIPE: sourceCommit, K08: 'ffac894aa98b8cd98476b8ea109ef2e2425c2a07', B35: { included: false, parser: sources.find(row => row.path === 'src/shell/parser.ts') }, EREengine: base.engineCommit, EREtransport: { revision: transportCommit, alternate4abbIncluded: false, files: sources.filter(row => row.path.includes('/ere/transport/')) } }, groupBodySha256: hash(Buffer.from(groupBytes(runner))), originalGroupBodySha256: hash(Buffer.from(groupBytes(originalPure.toString('utf8')))), oldSealSha256: hash(oldBytes) });
const visible = JSON.parse(read(path.join(parent, 'runtime-cases.json')));
if (visible.cases.length !== 18 || !read(path.join(own, 'host-protocols.ts')).toString('utf8').includes('["H01", "H02", "H03", "H04", "H05", "H06", "H07", "H08"]')) throw new Error('future matrix membership');
save('MATRIX.json', { layouts: ['source-built', 'offline-installed', 'physically-moved'], visibleCases: visible.cases, hostIds: ['H01','H02','H03','H04','H05','H06','H07','H08'], perLayout: { cases: 26, publicExecCalls: 27, contextInvokeCalls: 1 }, totals: { cases: 78, publicExecCalls: 81, contextInvokeCalls: 3 }, actualExecuted: 0, workersAllowed: 0, nativeAllowed: 0, publicPackageOriginAbsenceRequired: true });
save('DATA-CONTROLS.json', { checks: ['D01 exact old 24-group bodies', 'D02 corrected helper SHA', 'D03 runtime byte equality', 'D04 all seven transport blobs at 46611', 'D05 original parser; B35 excluded', 'D06 18+8 exact case membership and zero-Worker plan'].map(id => ({ id, status: 'PASS', category: 'DATA' })), productExecutions: 0 });
console.log(JSON.stringify({ sources: sources.length, projectionTree: tree(treeRoot), transport: transportCommit, transportFiles: sources.filter(row => /\/transport\/(owner|root)\.ts$/u.test(row.path)), controls: 6, productExecutions: 0 }));

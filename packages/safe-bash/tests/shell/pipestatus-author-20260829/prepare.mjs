import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repo = '/Users/kjopek/Workspace/safe-bash';
const own = path.join(repo, 'tests/shell/pipestatus-author-20260829');
const work = '/private/tmp/safe-bash-pipestatus-author-fresh';
const prior = path.join(repo, 'tests/compatibility/bash-ere-runtime-integration-author-20260829/rebind-v1');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const blobHash = bytes => crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const save = (name, value) => fs.writeFileSync(path.join(own, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
function bytes(filename, maximum = 4 * 1024 * 1024) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.size > maximum) throw new Error(`regular/size admission: ${filename}`);
  const value = fs.readFileSync(filename);
  if (value.length !== stat.size) throw new Error('read size drift');
  return value;
}
function binding(filename) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.size > 128 * 1024 * 1024) throw new Error('tool/file admission');
  const digest = crypto.createHash('sha256');
  const descriptor = fs.openSync(filename, 'r');
  const buffer = Buffer.alloc(65536);
  let total = 0;
  try { for (;;) { const count = fs.readSync(descriptor, buffer, 0, buffer.length, null); if (!count) break; total += count; digest.update(buffer.subarray(0, count)); } }
  finally { fs.closeSync(descriptor); }
  if (total !== stat.size) throw new Error('stream size drift');
  return { path: filename, size: total, mode: stat.mode & 0o777, sha256: digest.digest('hex') };
}
const manifestBytes = bytes(path.join(prior, 'SEAL.json'));
if (hash(manifestBytes) !== 'b3a3844213fe34017bb4b413bafda2433fd52a0d9165aed5810b01db245dfe95') throw new Error('prior manifest binding');
const priorSeal = JSON.parse(manifestBytes);
if (priorSeal.selectedCount !== 305 || priorSeal.sources.length !== 305) throw new Error('source membership');
const candidate = path.join(work, 'candidate');
fs.mkdirSync(candidate);
const sources = [];
for (const row of priorSeal.sources) {
  if (row.path.split('/').includes('AGENTS.md') || path.isAbsolute(row.path) || row.path.split('/').includes('..')) throw new Error('path admission');
  const content = bytes(path.join(prior, 'candidate', row.path));
  if (content.length !== row.bytes || hash(content) !== row.sha256 || blobHash(content) !== row.blob) throw new Error(`source binding: ${row.path}`);
  const destination = path.join(candidate, row.path);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content, { flag: 'wx', mode: Number.parseInt(row.mode, 8) & 0o777 });
  sources.push({ path: row.path, bytes: row.bytes, sha256: row.sha256, blob: row.blob, mode: row.mode, origin: priorSeal.selectedTree });
}
fs.appendFileSync(path.join(work, 'roles.log'), 'prepare-child git-cat-file\n');
const git = spawnSync('/usr/bin/git', ['-c', 'gc.auto=0', '-c', 'maintenance.auto=false', 'cat-file', '--batch'], {
  cwd: repo, encoding: null, input: Buffer.from('ffac894aa98b8cd98476b8ea109ef2e2425c2a07:src/shell/runtime.ts\nffac894aa98b8cd98476b8ea109ef2e2425c2a07:src/shell/arithmetic-parameters.ts\n'),
  timeout: 15000, maxBuffer: 2 * 1024 * 1024,
});
fs.writeFileSync(path.join(own, 'git.stderr'), git.stderr);
if (git.error || git.status !== 0 || git.signal) throw new Error('Git source acquisition failed');
let offset = 0;
const arithmetic = [];
for (let index = 0; index < 2; index++) {
  const end = git.stdout.indexOf(10, offset);
  const fields = git.stdout.subarray(offset, end).toString('ascii').split(' ');
  const size = Number(fields[2]);
  if (fields[1] !== 'blob' || !Number.isSafeInteger(size) || size < 1 || size > 1024 * 1024) throw new Error('stored blob header');
  offset = end + 1;
  const value = git.stdout.subarray(offset, offset + size);
  if (value.length !== size || blobHash(value) !== fields[0] || git.stdout[offset + size] !== 10) throw new Error('stored blob bytes');
  arithmetic.push(value); offset += size + 1;
}
if (offset !== git.stdout.length) throw new Error('extra Git bytes');
fs.writeFileSync(path.join(work, 'arithmetic-runtime.ts'), arithmetic[0]);
for (const relative of ['src/shell/runtime.ts', 'src/shell/arithmetic-parameters.ts', 'src/shell/pipestatus.ts']) {
  const content = bytes(path.join(repo, relative));
  if (relative.endsWith('arithmetic-parameters.ts') && !content.equals(arithmetic[1])) throw new Error('arithmetic source drift');
  fs.writeFileSync(path.join(candidate, relative), content);
  const row = { path: relative, bytes: content.length, sha256: hash(content), blob: blobHash(content), mode: '100644', origin: relative.endsWith('arithmetic-parameters.ts') ? 'ffac894aa98b8cd98476b8ea109ef2e2425c2a07' : 'PIPESTATUS author source' };
  const existing = sources.findIndex(entry => entry.path === relative);
  if (existing >= 0) sources[existing] = row; else sources.push(row);
}
const currentRuntime = bytes(path.join(candidate, 'src/shell/runtime.ts')).toString('utf8');
const baselineRuntime = arithmetic[0].toString('utf8');
const ereStart = baselineRuntime.indexOf('  private async ereDiagnostic(');
const ereNeedle = baselineRuntime.slice(ereStart, baselineRuntime.indexOf('  private invokeChild(', ereStart));
if (ereStart < 0 || !ereNeedle || !currentRuntime.includes(ereNeedle)) throw new Error('ERE source region changed');
for (const marker of ['evaluatePositionalArithmetic(command.expression', 'evaluatePositionalArithmetic(part.expression']) {
  const start = baselineRuntime.indexOf(marker);
  if (start < 0) throw new Error(`arithmetic marker ${marker}`);
  const end = baselineRuntime.indexOf('\n', baselineRuntime.indexOf('}, (prepared) => evaluateArithmetic(', start));
  if (end < start || !currentRuntime.includes(baselineRuntime.slice(start, end))) throw new Error('arithmetic callsite changed');
}
const tools = [priorSeal.node, ...priorSeal.typescript.map(row => ({ ...row, path: path.join(prior, 'node_modules', path.relative(path.join(repo, 'node_modules'), row.path)) }))];
for (const row of tools) {
  const actual = binding(row.path);
  if (actual.sha256 !== row.sha256 || actual.size !== row.size || actual.mode !== row.mode) throw new Error(`tool binding ${row.path}`);
}
fs.copyFileSync(path.join(own, 'types.ts'), path.join(candidate, 'src/shell/pipestatus-proof-types.ts'));
const fixtures = ['prepare.mjs', 'pure.mjs', 'types.ts', 'PRESEAL.md'].map(name => binding(path.join(own, name)));
const compiler = path.join(prior, 'node_modules/typescript/lib/tsc.js');
const compilerArgs = [compiler, '-p', path.join(candidate, 'tsconfig.build.json'), '--typeRoots', path.join(prior, 'node_modules/@types')];
const old = binding('/private/tmp/safe-bash-pipestatus-author-20260829-start.stdout');
sources.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
save('SEAL.json', { baseline: priorSeal.selectedTree, arithmeticCommit: 'ffac894aa98b8cd98476b8ea109ef2e2425c2a07', sources, count: sources.length, tools, fixtures, candidate, compiler: { executable: priorSeal.node.path, args: compilerArgs, timeoutMs: 120000 }, validationOnly: binding(path.join(candidate, 'src/shell/pipestatus-proof-types.ts')), oldCapture: { ...old, role: 'excluded instruction-contaminated historical capture', affectedByteExtent: 'unknown; not reread as text', census: 'old last command: shell + four sed; old census incomplete' }, runtimeRuns: 0 });
console.log(JSON.stringify({ sources: sources.length, tools: tools.length, fixtures: fixtures.length, compilerArgs, runtimeRuns: 0 }));

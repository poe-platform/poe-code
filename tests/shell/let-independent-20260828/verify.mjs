import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const own = dirname(fileURLToPath(import.meta.url)), repository = resolve(own, '../../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('/usr/bin/git', args, { cwd: repository, maxBuffer: 32 * 1024 * 1024 });
const read = name => readFileSync(join(own, name));
const bindings = JSON.parse(read('BINDINGS.json'));
assert.equal(bindings.candidate, null); assert.equal(bindings.productExecutions, 0); assert.equal(bindings.nativeReruns, 0);
assert.equal(hash(JSON.stringify(bindings.source)), bindings.sourceInventorySha256);
const paths = git(['ls-tree', '-r', '--name-only', bindings.baseline, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'README.md']).toString().trim().split('\n').sort();
assert.deepEqual(bindings.source.map(entry => entry.path), paths);
const overlays = [];
for (const entry of bindings.source) {
  assert.equal(entry.path.split('/').includes('AGENTS.md'), false);
  const bytes = git(['show', `${entry.revision}:${entry.path}`]);
  assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256);
  const tree = git(['ls-tree', entry.revision, '--', entry.path]).toString().split(/\s+/u);
  assert.equal(tree[1], 'blob'); assert.equal(tree[2], entry.blob); assert.equal(parseInt(tree[0], 8), entry.mode);
  if (entry.revision !== bindings.baseline) overlays.push({ path: entry.path, revision: entry.revision });
}
assert.deepEqual(overlays, [
  { path: 'src/fs/webdav/README.md', revision: bindings.dav },
  { path: 'src/fs/webdav/webdav.ts', revision: bindings.dav },
  { path: 'src/shell/runtime.ts', revision: bindings.cd },
]);
const runtime = git(['show', `${bindings.cd}:src/shell/runtime.ts`]).toString();
const builtins = /const shellBuiltinNames = new Set\(\[([\s\S]*?)\]\);/u.exec(runtime)?.[1];
assert.ok(builtins); assert.equal(builtins.includes('"let"'), false, 'accepted pre-code baseline must actually lack LET');
assert.equal(runtime.includes('"getopts"'), true);
for (const entry of bindings.references) { const bytes = readFileSync(join(repository, entry.path)); assert.equal(bytes.length, entry.bytes); assert.equal(hash(bytes), entry.sha256, entry.path); }
const packet = 'tests/shell/let-design-20260828/RATIFIED-AUTHOR-PACKET.md';
assert.deepEqual(git(['show', `${bindings.ratification}:${packet}`]), readFileSync(join(repository, packet)));
const nativeRoot = join(repository, 'tests/shell/let-design-20260828');
const nativeCases = JSON.parse(readFileSync(join(nativeRoot, 'CASES.json')));
const observations = readFileSync(join(nativeRoot, 'native-v1/rows.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
assert.equal(observations.length, 28);
for (const row of observations) {
  const source = nativeCases.find(entry => entry.id === row.id);
  assert.ok(source); assert.equal(hash(source.script), row.scriptSHA256);
  assert.equal(row.closure.natural, true); assert.equal(row.closure.pidAbsent, true); assert.equal(row.closure.groupAbsent, true);
  assert.equal(Buffer.from(row.stdoutBase64, 'base64').toString(), row.stdout);
  assert.equal(Buffer.from(row.stderrBase64, 'base64').toString(), row.stderr);
}
const pre = JSON.parse(readFileSync(join(nativeRoot, 'native-v1/PRE.json')));
assert.equal(pre.tools[0].sha256, bindings.nativeBinarySha256);
const cases = JSON.parse(read('cases.json')), synthetic = JSON.parse(read('synthetic.json'));
assert.equal(cases.length, 58); assert.equal(synthetic.length, 26);
assert.equal(new Set([...cases, ...synthetic].map(entry => entry.id)).size, 84);
assert.deepEqual([...new Set([...cases, ...synthetic].map(entry => entry.family))].sort(), Array.from({ length: 22 }, (_, index) => `L${String(index + 1).padStart(2, '0')}`));
for (const row of cases) {
  for (const field of ['id', 'family', 'script', 'stdout', 'stderr', 'reference']) assert.equal(typeof row[field], 'string');
  assert.ok(Number.isInteger(row.exitCode) && row.exitCode >= 0 && row.exitCode <= 255);
  assert.ok(Buffer.byteLength(row.script) < 1024); assert.ok(Buffer.byteLength(row.stdout + row.stderr) < 2048);
}
for (const row of synthetic) for (const field of ['id', 'family', 'route', 'setup', 'expect', 'kind']) assert.equal(typeof row[field], 'string');
assert.equal(cases.find(entry => entry.id === 'P22').stdout, '1:0\n');
assert.equal(cases.find(entry => entry.id === 'P40').stdout, '0:2:8\n');
assert.equal(cases.find(entry => entry.id === 'P12').stderr, 'shell: line 1: let: --help: unsupported option\n');
assert.equal(observations.find(entry => entry.id === 'N10').stdout, 'status=1;value=7\n');
assert.equal(observations.find(entry => entry.id === 'N17').stdout, 'status=0;value=8;other=8\n');
const seal = JSON.parse(read('SEAL.json')), actual = {};
for (const name of readdirSync(own).sort()) {
  const path = join(own, name), stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), name);
  if (name !== 'SEAL.json') actual[relative(own, path)] = hash(readFileSync(path));
}
assert.deepEqual(actual, seal);
process.stdout.write(JSON.stringify({ verdict: 'pre-code data/source/reference seal verified; not product acceptance', families: 22, literalRows: 58, syntheticProcedures: 26, selectedInputs: bindings.source.length, preservedNativeObservations: 28, productExecutions: 0, nativeReruns: 0, sourceContentsCopied: 0, runtimeWindow: 'released by Poincare; root author go still required' }) + '\n');

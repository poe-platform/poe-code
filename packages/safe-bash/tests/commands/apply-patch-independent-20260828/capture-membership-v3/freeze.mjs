import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const own = path.dirname(fileURLToPath(import.meta.url)), repository = path.resolve(own, '../../../..');
const prior = path.join(own, '../path-transport-v2'), review = path.join(own, '../path-transport-v2-review');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function binding(filename) {
  const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink());
  const hasher = crypto.createHash('sha256'), buffer = Buffer.alloc(65536), descriptor = fs.openSync(filename, 'r');
  try { let bytes; while ((bytes = fs.readSync(descriptor, buffer)) > 0) hasher.update(buffer.subarray(0, bytes)); }
  finally { fs.closeSync(descriptor); }
  return { path: path.relative(repository, filename), bytes: stat.size, mode: stat.mode & 0o777, sha256: hasher.digest('hex') };
}
function put(name, value) {
  const filename = path.join(own, name); assert.equal(fs.existsSync(filename), false);
  const body = JSON.stringify(value, null, 2) + '\n';
  const patch = `*** Begin Patch\n*** Add File: ${path.relative(repository, filename)}\n${body.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`;
  const applied = spawnSync('apply_patch', [], { cwd: repository, input: patch, encoding: 'utf8', maxBuffer: 1024 * 1024 }); assert.equal(applied.status, 0, applied.stderr);
}
const oldSeal = JSON.parse(fs.readFileSync(path.join(prior, 'EXECUTION-SEAL.json')));
const composition = JSON.parse(fs.readFileSync(path.join(own, 'FUTURE-COMPOSITION.json')));
const futureSeal = structuredClone(oldSeal);
futureSeal.schema = 'apply-patch-independent-capture-membership-execution-seal-v3';
futureSeal.files['controller.mjs'] = { bytes: composition.derivedControllerBytes, mode: 0o644, sha256: composition.derivedControllerSha256 };
for (const name of ['capture-io.mjs', 'controller-admission.mjs', 'manifest-bindings.mjs', 'manifests/future-inventory.json']) {
  const { path: unused, ...entry } = binding(path.join(own, name)); futureSeal.files['../' + name] = entry;
}
const { path: unused, ...pathBinding } = binding(path.join(prior, 'path-bytes.mjs'));
futureSeal.files['../../path-transport-v2/path-bytes.mjs'] = pathBinding;
futureSeal.repair = { ...futureSeal.repair, version: 3, admission: 'source-authenticated finite capture manifest; controller-admission.mjs before first child/raw tree/object use', previousExecutionSealSha256: hash(fs.readFileSync(path.join(prior, 'EXECUTION-SEAL.json'))), futureOutputHashes: null };
assert.deepEqual(futureSeal.jobs, oldSeal.jobs); assert.deepEqual(futureSeal.bounds, oldSeal.bounds); assert.deepEqual(futureSeal.counts, oldSeal.counts);
put('FUTURE-EXECUTION-SEAL.json', futureSeal);
const rootInputNames = fs.readdirSync(own).filter(name => !['ROOT-COORDINATION.md', 'REPORT.md', 'runs'].includes(name)).sort();
assert.ok(!rootInputNames.includes('PRESEAL.json'));
const manifestNames = fs.readdirSync(path.join(own, 'manifests')).sort();
const source = rootInputNames.flatMap(name => name === 'manifests' ? manifestNames.map(file => path.join(own, name, file)) : [path.join(own, name)]);
const oldSourceNames = ['controller.mjs', 'capture-io.mjs', 'path-bytes.mjs', 'supervisor.mjs', 'deadline.mjs', 'EXECUTION-SEAL.json', 'METADATA.json', 'EXPECTED.json', 'bootstrap.mjs', 'loader.mjs', 'worker.mjs', 'guard-control.mjs'];
for (const name of oldSourceNames) if (oldSeal.files[name]) assert.equal(binding(path.join(prior, name)).sha256, oldSeal.files[name].sha256);
const reviewNames = ['CONTROLS.json', 'run-review-v2.mjs', 'review-reference.mjs', 'REPORT.md', 'SOURCE-REVIEW.md'];
const controls = JSON.parse(fs.readFileSync(path.join(own, 'CONTROLS.json')));
const work = path.join(own, 'runs/author-01/work');
const entries = [...source, ...oldSourceNames.map(name => path.join(prior, name)), ...reviewNames.map(name => path.join(review, name)), process.execPath].map(binding);
const seal = {
  schema: 'c18-author-source-preseal-v3', classification: 'DATA/SYNTHETIC AUTHOR, NOT independent acceptance',
  priorSource: 'd8cbb7d76459e14d20f57e19f7c01ce04fa08702', priorEvidence: 'd3817018efd58d7a6e319192ef388aff7c9cc2cd', priorVerifier: 'd50aa32af3d5c7398252d2eed6f4cca530bd2c2b',
  candidate: '58be2d6c5706f3e90f01d48e695ecfd9daa52669', productEvidence: '767b6729d3acac0dd17c42dfb9e0b93e6e9c4de5',
  priorExecutionSealSha256: composition.authority ? futureSeal.repair.previousExecutionSealSha256 : null,
  entries, rootInputNames, manifestNames, expected: controls.expected,
  limits: { totalMsIncludingCleanup: 300000, maximumChildren: 8, plannedChildren: 1, peakIncludingController: 2, captures: 16777216, work: 67108864, retryPolicy: 'none; preserve failure, no rebaseline, no cap increase' },
  child: { executable: process.execPath, args: ['--unhandled-rejections=strict', '--max-old-space-size=128', '--permission', `--allow-fs-read=${own}`, `--allow-fs-read=${path.join(prior, 'path-bytes.mjs')}`, `--allow-fs-read=${path.join(repository, 'package.json')}`, `--allow-fs-write=${work}`, `--allow-fs-write=${work}/*`, path.join(own, 'run-controls.mjs')], env: { PATH: '/usr/bin:/bin', HOME: work, TMPDIR: work, NO_COLOR: '1' }, cwd: repository, timeoutMs: 60000, maxBytes: 1048576, grandchildren: 0 },
  recipe: { budgetOrigin: 'first author-run.mjs control invocation, performance.now, includes pre/post guard and cleanup', dispatch: 'one permission-restricted Node DATA child via exact prior qualified supervise; no shell/Git/build/runtime/network/native oracle/private imports', input: 'CONTROLS.json exact original C18 compact JSON bytes and frozen manifests; all manifests source SHA-bound by manifest-bindings.mjs', expected: '66 helper + 66 composed admission observations, each frozen accepted/rejected; original C18 rejected then same namespace restored and joins 126 bytes', output: 'unique runs/author-01/stdout.raw, stderr.raw, receipt.json, all wx; failed outputs preserved', cleanup: 'only unique work subtree after child close and process-group absence; lstat, unlink symlinks without following; rmdir descendants/root; source+manifest guards before/after', noReplays: 'original197P/1F/1unsupported/7unrun,98/50002,25DATA/68NOTRUN,274selected/882planned,32+80 unchanged' },
  future: { executionSealSha256: hash(fs.readFileSync(path.join(own, 'FUTURE-EXECUTION-SEAL.json'))), generatedProductHashes: null, policy: 'unchanged 6600000ms,70 jobs; HOLD pending different reviewer and fresh root GO; no staging/dispatch now' }
};
put('PRESEAL.json', seal);
console.log(JSON.stringify({ presealSha256: hash(fs.readFileSync(path.join(own, 'PRESEAL.json'))), files: entries.length, expected: seal.expected, futureExecutionSealSha256: seal.future.executionSealSha256, node: process.execPath }));

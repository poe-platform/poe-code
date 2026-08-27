import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const own = dirname(import.meta.filename);
const repo = resolve(own, '../../../..');
const output = process.argv[2];
assert.ok(output?.startsWith('/tmp/'), 'fresh /tmp output directory required');
await mkdir(output);
const temporary = await mkdtemp('/tmp/safe-bash-authority-independent-');
const canonical = '92e4118';
const evidenceCommit = '9122522';
const authorPath = 'tests/integration/full-gate-20260827/authority-reconciliation';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: repo, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 64 * 1024 * 1024 });
const writeJson = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const report = { startedAt: new Date().toISOString(), canonical: git(['rev-parse', canonical]).toString().trim(), evidence: git(['rev-parse', evidenceCommit]).toString().trim(), movingHead: git(['rev-parse', 'HEAD']).toString().trim(), movingStatus: git(['status', '--short']).toString(), commands: [], mutants: [], observations: {}, cleanup: false };
const raw = git(['show', `${evidenceCommit}:${authorPath}/run.mjs`]).toString();
let runner = raw.replace('from "../supervise.mjs"', 'from "./supervise.mjs"')
  .replace('const root = resolve(owned, "../../../..");', `const root = ${JSON.stringify(repo)};`)
  .replace('const old = JSON.parse(await readFile(join(owned, "../evidence/classification.json"), "utf8"));', `const old = JSON.parse(git("show", "${evidenceCommit}:tests/integration/full-gate-20260827/evidence/classification.json").toString());`)
  .replace('const data = await readFile(join(root, path));', `const data = git("show", "${canonical}:" + path);`);
assert.notEqual(runner, raw);
report.authorRunner = { originalSha256: hash(raw), executedSha256: hash(runner), changes: ['temporary supervisor import', 'read-only repository lookup', 'pinned original classification', 'pinned canonical fixture bytes'] };
await writeFile(join(temporary, 'run.mjs'), runner);
await writeFile(join(temporary, 'supervise.mjs'), git(['show', `${evidenceCommit}:tests/integration/full-gate-20260827/supervise.mjs`]));
const { supervise } = await import(pathToFileURL(join(temporary, 'supervise.mjs')).href);
const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', AUTHORITY_RECONCILIATION_OUTPUT: output, TSX_DISABLE_CACHE: '1', SAFEJS_LOCAL_ROOT: '', LC_ALL: 'C', LANG: 'C' };
let scratch;
async function author(mode, extra = []) {
  const result = await supervise(process.execPath, [join(temporary, 'run.mjs'), mode, ...extra], { cwd: repo, env, stdout: join(output, `author-${mode}.stdout`), stderr: join(output, `author-${mode}.stderr`), timeoutMs: 180000, maxOutputBytes: 8 * 1024 * 1024 });
  report.commands.push({ role: `author-${mode}`, ...result });
  assert.equal(result.status, 0, `author ${mode}`);
  assert.deepEqual(result.survivors, []);
}
async function tests(label, args, expectedFail = false) {
  const result = await supervise(process.execPath, args, { cwd: scratch, env: { ...env, TMPDIR: join(scratch, 'tmp') }, stdout: join(output, `${label}.stdout`), stderr: join(output, `${label}.stderr`), timeoutMs: 120000, maxOutputBytes: 8 * 1024 * 1024 });
  const text = await readFile(join(output, `${label}.stdout`), 'utf8');
  result.counts = Object.fromEntries([...text.matchAll(/^# (tests|pass|fail|skipped|cancelled|todo) (\d+)$/gm)].map(match => [match[1], Number(match[2])]));
  result.failures = [...text.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]);
  report.commands.push({ role: label, ...result });
  await writeJson(join(output, `${label}.json`), result);
  assert.equal(result.timedOut, false); assert.equal(result.outputExceeded, false); assert.deepEqual(result.survivors, []);
  assert.equal(result.status, expectedFail ? 1 : 0, label);
  return result;
}
function patch(file, before, after) {
  const body = `*** Begin Patch\n*** Update File: ${file}\n@@\n${before.trimEnd().split('\n').map(line=>'-'+line).join('\n')}\n${after.trimEnd().split('\n').map(line=>'+'+line).join('\n')}\n*** End Patch\n`;
  const result = spawnSync('apply_patch', [], { input: body, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
}
try {
  await author('baseline');
  const state = JSON.parse(await readFile(join(output, 'evidence/session.json'), 'utf8'));
  scratch = state.scratch;
  report.source = state.commit;
  await author('candidate', ['final']);
  await author('mutants');
  const controls = 'tests/integration/full-gate-20260827/authority-reconciliation-independent/controls.test.ts';
  await mkdir(dirname(join(scratch, controls)), { recursive: true });
  const bytes = await readFile(join(own, 'controls.test.ts'));
  await writeFile(join(scratch, controls), bytes);
  report.controlsSha256 = hash(bytes);
  await writeFile(join(output, 'controls.test.ts.txt'), bytes);
  const testArgs = ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=tap'];
  await tests('independent-controls', [...testArgs, controls]);
  await tests('independent-types', ['node_modules/typescript/bin/tsc', '--noEmit', '--target', 'ES2023', '--lib', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--skipLibCheck', '--types', 'node', controls]);
  const mutations = [
    { name: 'stale-s3-proof', file: 'src/fs/s3/authority.ts', before: 'if (proof?.query === query) acceptedHeads.set(output, proof.entry);', after: 'if (proof) acceptedHeads.set(output, proof.entry);', catcher: 'replayed HEAD' },
    { name: 'wrong-path-s3-proof', file: 'src/fs/s3/authority.ts', before: 'query.Bucket === input.Bucket && query.Key === input.Key', after: 'query.Bucket === input.Bucket', catcher: 'wrong-path HEAD' },
    { name: 'fabricated-unknown-native-identity', file: 'src/fs/mount/identity.ts', before: 'if (!left || !right || !complete(left) || !complete(right)) return "unknown";', after: 'if (!left || !right || !complete(left) || !complete(right)) return "distinct";', catcher: 'honest opaque remapping' },
    { name: 'shaped-away-explicit-error', file: 'src/fs/mount/comparison.ts', before: 'throw error;', after: 'throw new FsError("EIO", { cause: error });', count: 3, catcher: 'explicit error' },
  ];
  for (const mutation of mutations) {
    const file = join(scratch, mutation.file);
    const before = await readFile(file, 'utf8');
    assert.equal(before.split(mutation.before).length - 1, mutation.count ?? 1, mutation.name);
    const after = before.replaceAll(mutation.before, mutation.after);
    patch(file, before, after);
    try {
      const result = await tests(`independent-mutant-${mutation.name}`, [...testArgs, controls], true);
      assert.equal(result.counts.tests, 17);
      assert.equal(result.counts.skipped + result.counts.cancelled + result.counts.todo, 0);
      assert.ok(result.failures.some(name=>name.includes(mutation.catcher)), mutation.name);
      report.mutants.push({ ...mutation, beforeSha256: hash(before), afterSha256: hash(after), failures: result.failures, isolatedOnly: true });
    } finally { patch(file, after, before); }
    assert.equal(hash(await readFile(file)), hash(before));
  }
  await tests('independent-restored', [...testArgs, controls]);
  const helper = join(scratch, 'tests/fs/webdav/mock.ts');
  const current = await readFile(helper, 'utf8');
  const historical = git(['show', 'd799cbb:tests/fs/webdav/mock.ts']).toString();
  patch(helper, current, historical);
  try { report.observations.oldHelper = await tests('old-helper-compatibility', [...testArgs, 'tests/fs/mount/identity-compatibility-review/compatibility.test.ts'], true); }
  finally { patch(helper, historical, current); }
  report.observations.currentHelper = await tests('current-helper-compatibility', [...testArgs, 'tests/fs/mount/identity-compatibility-review/compatibility.test.ts']);
  await tests('isolated-build-for-matrix', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']);
  report.observations.adapterMatrix = await tests('unchanged-adapter-matrix', [...testArgs, 'tests/integration/adapter-tools/matrix.test.ts'], true);
  assert.equal(report.observations.adapterMatrix.counts.tests, 79);
  assert.equal(report.observations.adapterMatrix.counts.fail, 2);
  assert.deepEqual(report.observations.adapterMatrix.failures.sort(), ['s3: create, copy, append, inspect and remove files', 'webdav: create, copy, append, inspect and remove files']);
  await author('cleanup');
  report.cleanup = true;
} finally {
  if (scratch && !report.cleanup) { await rm(scratch, { recursive: true, force: true }); report.fallbackRemoved = scratch; }
  await rm(temporary, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  await writeJson(join(output, 'independent-run.json'), report);
}
console.log(JSON.stringify({ output, source: report.source, independentMutants: report.mutants.length, cleanup: report.cleanup }, null, 2));

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { owned, root, runChild, save, sha256, transport } from './support.mjs';

const inputs = JSON.parse(await readFile(resolve(owned, 'inputs.json')));
const native = JSON.parse(await readFile(resolve(owned, 'native-role-corrected.json')));
const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const commit = inputs.sourceCommit;
const archiveArgs = ['archive', '--format=tar', commit, 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'];
const tar = git(...archiveArgs);
const committed = {};
for (const line of git('ls-tree', '-r', commit, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json').toString().trim().split('\n')) {
  const [metadata, path] = line.split('\t'), [mode, type, blob] = metadata.split(' ');
  assert.equal(type, 'blob'); committed[path] = { mode, blob, sha256: sha256(git('cat-file', 'blob', blob)) };
}
async function inventory(directory) {
  const result = {};
  async function visit(current) { for (const entry of (await readdir(current, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) { const path = resolve(current, entry.name); if (entry.isDirectory()) await visit(path); else if (entry.isFile()) result[relative(directory, path)] = sha256(await readFile(path)); } }
  await visit(directory); return result;
}
const parent = await realpath(await mkdtemp('/tmp/safe-bash-canonical-review-')), archiveRoot = resolve(parent, 'project');
const toolchainRoot = await realpath(resolve(root, 'node_modules'));
const manifests = {}, records = [], startedAt = new Date().toISOString();
const store = value => { const key = sha256(JSON.stringify(value)); manifests[key] = value; return key; };
const snapshotLive = () => ({ head: git('rev-parse', 'HEAD').toString().trim(), status: git('status', '--short').toString(), index: git('diff', '--cached', '--raw').toString() });
const liveBefore = snapshotLive();
const helperPath = 'tests/shell-stress/current-shell/support.mjs', tracePath = 'tests/shell-stress/errexit-holdout/isolated-trace.mjs';
assert.equal(sha256(await readFile(resolve(root, helperPath))), 'd7b278db709f869a03e5cce56c501011a1162465b03ecfc1663465b0163c6f8a');
assert.equal(sha256(await readFile(resolve(root, tracePath))), sha256(git('show', `694ec8a:${tracePath}`)));
let saved = false;
try {
  await mkdir(archiveRoot); execFileSync('/usr/bin/tar', ['-xf', '-', '-C', archiveRoot], { input: tar });
  const extracted = await inventory(archiveRoot);
  assert.deepEqual(Object.keys(extracted).sort(), Object.keys(committed).sort());
  for (const [path, proof] of Object.entries(committed)) assert.equal(extracted[path], proof.sha256);
  const copied = {};
  const copy = async (from, to = from) => { await mkdir(resolve(archiveRoot, to, '..'), { recursive: true }); await copyFile(resolve(root, from), resolve(archiveRoot, to)); copied[to] = { from, hash: sha256(await readFile(resolve(root, from))) }; assert.equal(sha256(await readFile(resolve(archiveRoot, to))), copied[to].hash); };
  const local = relative(root, owned);
  for (const name of ['inputs.json', 'native-role-corrected.json', 'product.mjs', 'support.mjs']) await copy(`${local}/${name}`);
  await copy(helperPath); await copy(tracePath, `${local}/isolated-trace.mjs`);
  await symlink(toolchainRoot, resolve(archiveRoot, 'node_modules'));
  const toolchainFiles = await inventory(toolchainRoot);
  const policy = { sourceCommit: commit, archiveRoot, liveRoot: root, toolchainRoot, archiveFiles: await inventory(archiveRoot), toolchainFiles };
  const policyPath = resolve(archiveRoot, '.isolation.json'); await writeFile(policyPath, JSON.stringify(policy));
  async function snapshot() { return { archive: await inventory(archiveRoot), toolchain: await inventory(toolchainRoot), symlink: { path: resolve(archiveRoot, 'node_modules'), target: await readlink(resolve(archiveRoot, 'node_modules')), realpath: await realpath(resolve(archiveRoot, 'node_modules')) } }; }
  const initial = await snapshot();
  for (const context of ['canonical', 'original']) {
    const specimens = context === 'canonical' ? inputs.rows : inputs.rows.filter(row => ['differential', 'syntax', 'gaps'].includes(row.cohort));
    for (const [index, specimen] of specimens.entries()) {
      const before = await snapshot(), trace = resolve(parent, `${context}-${index}.jsonl`);
      const args = ['--unhandled-rejections=strict', '--import', resolve(archiveRoot, local, 'isolated-trace.mjs'), '--import', 'tsx', resolve(archiveRoot, local, 'product.mjs'), specimen.id, context];
      const env = { PATH: '/nonexistent', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', CURRENT_SHELL_IMPORT_TRACE: '', ERREXIT_ISOLATION_POLICY: policyPath, ERREXIT_ISOLATION_TRACE: trace };
      const run = await runChild(process.execPath, args, { cwd: archiveRoot, env, deadline: 5000 });
      const after = await snapshot();
      const loads = (await readFile(trace, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      const issues = loads.filter(load => !load.valid || load.liveSource || load.beforeHash !== load.hash || (load.category === 'toolchain' ? before.toolchain[load.key] !== load.hash || after.toolchain[load.key] !== load.hash : before.archive[load.key] !== load.hash || after.archive[load.key] !== load.hash));
      const product = Object.fromEntries(loads.filter(load => load.category === 'product').map(load => [load.key, load.hash]));
      let result; try { result = JSON.parse(Buffer.from(run.stdout, 'base64').toString()); } catch { result = { actual: { protocolError: true } }; }
      const valid = transport(run) && run.status === 0 && isDeepStrictEqual(before, after) && issues.length === 0 && ['src/index.ts', 'src/shell/runtime.ts', 'src/commands/search/rg.ts'].every(path => product[path] === committed[path].sha256) && result.forbidden?.length === 0;
      const comparisons = native.profiles.map(profile => {
        const reference = profile.rows.find(row => row.id === specimen.id);
        const expected = { stdout: reference.result.stdout, stderr: reference.result.stderr, status: reference.result.status, effects: reference.effects };
        const exactFields = Object.fromEntries(Object.keys(expected).map(field => [field, isDeepStrictEqual(result.actual?.[field], expected[field])]));
        const streamsExact = ['stdout', 'stderr', 'status'].every(field => exactFields[field]);
        const files = value => Object.fromEntries(Object.entries(value ?? {}).map(([name, { mode, ...entry }]) => [name, entry]));
        const originalFieldShape = specimen.cohort === 'discovery' || specimen.cohort === 'closure' ? streamsExact : streamsExact && isDeepStrictEqual(files(result.actual?.effects), files(expected.effects));
        return { profile: profile.id, expected, exactFields, rawExact: Object.values(exactFields).every(Boolean), streamsExact, originalFieldShape, originalAssertionCaveat: specimen.cohort === 'closure' ? 'Strict stderr is retained here, even where the original test used diagnostic fragments. Whole fixture effects/modes are retained as additional raw evidence, never hidden.' : specimen.cohort === 'syntax' ? 'Original syntax rows assert status2, empty stdout/files and nonempty stderr, not exact stderr. This record is stricter and does not silently reclassify them.' : null };
      });
      records.push({ id: specimen.id, cohort: specimen.cohort, context, valid, before: store(before), after: store(after), loads: store(loads), product: store(product), issues, result, comparisons, launch: { args, cwd: archiveRoot, env, deadlineMs: 5000 }, run });
    }
    console.log(JSON.stringify({ context, executions: records.filter(row => row.context === context).length, valid: records.filter(row => row.context === context && row.valid).length }));
  }
  const endpoint = await snapshot();
  for (const [path, proof] of Object.entries(inputs.inputs)) assert.equal(sha256(await readFile(resolve(root, path))), proof.sha256, `Original author input changed: ${path}`);
  const report = { capturedAt: new Date().toISOString(), startedAt, sourceCommit: commit, archiveArgs, tarSha256: sha256(tar), archiveRoot, committed, copied, initial: store(initial), endpoint: store(endpoint), stable: isDeepStrictEqual(initial, endpoint), manifests, records, liveBefore, liveAfter: snapshotLive(), node: { path: process.execPath, version: process.version, sha256: sha256(await readFile(process.execPath)) }, counts: { canonical: 169, originalContext: 88, totalProduct: 257 }, originalInputGuard: true, cleanup: { savedBeforeRemoval: true, allGroupsAbsent: records.every(row => !row.run.groupAlive) } };
  save('baseline-6e3e316.json', report); saved = true;
} finally {
  await rm(parent, { recursive: true, force: true });
  if (saved) save('baseline-cleanup.json', { directory: parent, directoryRemoved: true, rawSha256: sha256(await readFile(resolve(owned, 'baseline-6e3e316.json'))), groupsAbsent: records.every(row => { try { process.kill(-row.run.pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } }) });
}

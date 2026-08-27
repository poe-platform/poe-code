import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { owned, root, runChild, save, sha256, transport } from './support.mjs';
import { audit, blob, candidateCommit, candidateCommits, git, migration, review, sourceCommit, testRoots } from './acceptance-audit.mjs';

const output = 'acceptance-execution.json';
assert.equal(existsSync(resolve(owned, output)), false);
const inputAudit = await audit();
const parent = realpathSync(await mkdtemp(resolve(tmpdir(), 'safe-bash-profile-review-')));
const archive = resolve(parent, 'project');
await mkdir(archive);
const sourcePaths = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'];
const tar = git(['archive', '--format=tar', sourceCommit, ...sourcePaths]);
execFileSync('/usr/bin/tar', ['-xf', '-', '-C', archive], { input: tar });
const committed = {};
for (const line of git(['ls-tree', '-r', sourceCommit, ...sourcePaths]).toString().trim().split('\n')) {
  const [mode, kind, object, path] = line.split(/\s+/u);
  assert.equal(kind, 'blob');
  const bytes = await readFile(resolve(archive, path));
  assert.deepEqual(bytes, git(['cat-file', 'blob', object]));
  committed[path] = { mode, blob: object, sha256: sha256(bytes) };
}
const prep = JSON.parse(blob('ab02ed8', `${migration}/inputs.json`));
const copied = {};
for (const path of [...Object.keys(prep.originals), ...['primary-reference.ts', 'discovery-profile.ts', 'historical-discovery.ts', 'primary-fixtures.json', 'native.json'].map(name => `${migration}/${name}`)]) {
  const bytes = blob(candidateCommit, path);
  assert.deepEqual(bytes, await readFile(resolve(root, path)));
  await mkdir(dirname(resolve(archive, path)), { recursive: true });
  await writeFile(resolve(archive, path), bytes);
  copied[path] = { commit: candidateCommit, sha256: sha256(bytes), blob: git(['rev-parse', `${candidateCommit}:${path}`]).toString().trim() };
}
for (const name of ['acceptance-trace.mjs', 'acceptance-types.mjs']) {
  const path = `${review}/${name}`, bytes = await readFile(resolve(root, path));
  await mkdir(dirname(resolve(archive, path)), { recursive: true });
  await writeFile(resolve(archive, path), bytes); copied[path] = { reviewerDriver: true, sha256: sha256(bytes) };
}
await symlink(resolve(root, 'node_modules'), resolve(archive, 'node_modules'), 'dir');
function tree(directory) {
  const files = {};
  for (const name of readdirSync(directory).sort()) {
    const path = resolve(directory, name), stat = lstatSync(path);
    if (stat.isSymbolicLink()) files[path] = `symlink:${readlinkSync(path)}`;
    else if (stat.isDirectory()) Object.assign(files, tree(path));
    else files[path] = sha256(readFileSync(path));
  }
  return files;
}
const toolsBefore = tree(realpathSync(resolve(root, 'node_modules')));
const original = tree(archive);
const manifests = {};
const store = value => { const key = sha256(JSON.stringify(value)); manifests[key] = value; return key; };
const runs = [];
const loader = pathToFileURL(resolve(archive, review, 'acceptance-trace.mjs')).href;
async function run(label, args, { expectedStatus = 0, timeout = 90000, mutation = null } = {}) {
  const before = tree(archive);
  const policyPath = resolve(parent, `${label}-policy.json`), trace = resolve(parent, `${label}-loads.jsonl`);
  const policy = { files: { ...before, ...toolsBefore } };
  await writeFile(policyPath, JSON.stringify(policy));
  const env = { PATH: '/usr/bin:/bin', HOME: parent, TMPDIR: parent, LANG: 'C', LC_ALL: 'C', TZ: 'UTC', NODE_OPTIONS: `--import=${loader}`, PROFILE_REVIEW_POLICY: policyPath, PROFILE_REVIEW_TRACE: trace };
  const result = await runChild(process.execPath, args, { cwd: archive, env, deadline: timeout });
  const after = tree(archive);
  const loads = existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const problems = loads.filter(load => !load.valid || load.hash !== before[load.path] && load.hash !== toolsBefore[load.path] || load.hash !== after[load.path] && load.hash !== toolsBefore[load.path]);
  const productLoads = loads.filter(load => load.path.startsWith(resolve(archive, 'src') + '/'));
  const productMismatches = productLoads.filter(load => committed[relative(archive, load.path)]?.sha256 !== load.hash);
  const text = Buffer.from(result.stdout, 'base64').toString();
  const counts = Object.fromEntries([...text.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
  const record = { label, args, env, mutation, before: store(before), after: store(after), loads: store(loads), result, counts, guard: { stable: isDeepStrictEqual(before, after), problems, productMismatches, actualLoads: loads.length, productLoads: productLoads.length, publicIndexLoads: loads.filter(load => load.path === resolve(archive, 'src/index.ts')).length, valid: isDeepStrictEqual(before, after) && loads.length > 0 && problems.length === 0 && productMismatches.length === 0 }, expectedStatus };
  runs.push(record);
  console.log(JSON.stringify({ label, status: result.status, counts, guard: record.guard.valid }));
  assert.ok(transport(result), label);
  assert.ok(record.guard.valid, label);
  assert.equal(result.status, expectedStatus, label);
  return record;
}
const testArgs = paths => ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1', '--test-reporter=tap', ...paths];
let failure = null;
try {
  const canonical = await run('canonical-four', testArgs(testRoots));
  assert.deepEqual(canonical.counts, { tests: 183, pass: 183, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  const historical = await run('strict-historical', testArgs([`${migration}/historical-discovery.ts`]), { expectedStatus: 1 });
  assert.deepEqual(historical.counts, { tests: 52, pass: 36, fail: 16, cancelled: 0, skipped: 0, todo: 0 });
  const failures = [...Buffer.from(historical.result.stdout, 'base64').toString().matchAll(/^not ok \d+ - (.+)$/gmu)].map(match => match[1]);
  assert.deepEqual(failures, inputAudit.original27.filter(row => row.classification === 'historical-bash32-profile').map(row => row.name));
  save('acceptance-canonical-checkpoint.json', { at: new Date().toISOString(), sourceCommit, candidateCommits, runs: runs.map(({ loads, before, after, ...record }) => ({ ...record, loadsHash: loads, beforeHash: before, afterHash: after })), provisional: 'Raw manifests follow in final execution artifact; not mutation/type acceptance.' });
  const scoped = await run('scoped-types', [`${review}/acceptance-types.mjs`, 'scoped'], { timeout: 60000 });
  const typeData = JSON.parse(Buffer.from(scoped.result.stdout, 'base64').toString());
  scoped.compiler = typeData;
  assert.ok(typeData.guardValid);
  for (const read of typeData.reads) assert.equal(read.before, original[read.path] ?? toolsBefore[realpathSync(read.path)], read.path);
  const laboratory = await import('./acceptance-mutations.mjs');
  await laboratory.mutations({ archive, run, testArgs, original });
} catch (error) { failure = { name: error.name, message: error.message, stack: error.stack }; }
const endpoint = tree(archive);
const toolsAfter = tree(realpathSync(resolve(root, 'node_modules')));
const evidence = { recordedAt: new Date().toISOString(), sourceCommit, candidateCommits, archive, parent, tarSha256: sha256(tar), committed, copied, inputAuditSha256: sha256(await readFile(resolve(owned, 'acceptance-input-audit.json'))), original: store(original), endpoint: store(endpoint), toolsBefore: store(toolsBefore), toolsAfter: store(toolsAfter), manifests, runs, failure, sourceAndInputsRestored: isDeepStrictEqual(original, endpoint), toolsStable: isDeepStrictEqual(toolsBefore, toolsAfter), node: { path: process.execPath, version: process.version, sha256: sha256(await readFile(process.execPath)) }, scope: 'Full immutable6e source + exact candidateC test dependencies. No live source overlay. Only declared lab test/helper mutations, never product source mutations.' };
save(output, evidence);
await rm(parent, { recursive: true, force: true });
save('acceptance-cleanup.json', { recordedAt: new Date().toISOString(), parent, directoryRemoved: !existsSync(parent), allOwnedGroupsAbsent: runs.every(record => !record.result.groupAlive), rawSha256: sha256(await readFile(resolve(owned, output))) });
if (failure) throw new Error(`Acceptance stopped: ${failure.message}`);
assert.ok(evidence.sourceAndInputsRestored && evidence.toolsStable);

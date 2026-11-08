import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { git, owned, root, runChild, save, sha256, transport } from './support.mjs';

const sourceCommit = 'e7f4f2e3753184415f8098445c2009cb4cd9a6e9';
const inputCommit = '199038f4c96084f87e161bdbd72dc50a48b45a29';
const prefix = 'tests/shell-stress/env-split-holdout';
const tracePath = 'tests/shell-stress/canonical-profile-review/acceptance-trace.mjs';
const traceCommit = '303d18449c6e01bae4f33dada2f2022f95a56d49';
const output = 'baseline-e7f4f2e-bytes-v2.json';
assert.equal(existsSync(resolve(owned, output)), false, 'No evidence overwrite or retry for green');
const frozenPaths = git(['ls-tree', '-r', '--name-only', inputCommit, prefix]).toString().trim().split('\n');
const blob = (commit, path) => git(['show', `${commit}:${path}`]);
async function frozenGuard() {
  const proof = {};
  for (const path of frozenPaths) {
    const expected = blob(inputCommit, path), current = await readFile(resolve(root, path));
    assert.deepEqual(current, expected, path);
    proof[path] = { commit: inputCommit, blob: git(['rev-parse', `${inputCommit}:${path}`]).toString().trim(), sha256: sha256(current) };
  }
  return proof;
}
const historyCommit = '7839db5370fe09d57f7aaaea29b5b2acb874cd36';
const historyPaths = git(['ls-tree', '-r', '--name-only', historyCommit, prefix]).toString().trim().split('\n');
assert.equal(historyPaths.length, 26);
async function historyGuard() {
  const proof = {};
  for (const path of historyPaths) {
    const bytes = await readFile(resolve(root, path)); assert.deepEqual(bytes, blob(historyCommit, path), path);
    proof[path] = { commit: historyCommit, blob: git(['rev-parse', `${historyCommit}:${path}`]).toString().trim(), sha256: sha256(bytes) };
  }
  return proof;
}
const historyBefore = await historyGuard();
const versionedNames = ['product-row-bytes-v2.mjs', 'probe-bytes-v2.mjs', 'corrected-baseline.mjs'];
async function versionedGuard() {
  return Object.fromEntries(await Promise.all(versionedNames.map(async name => [name, sha256(await readFile(resolve(owned, name)))])));
}
const versionedBefore = await versionedGuard();
const oldWrite = "await fs.writeFile(row.fixture.path, row.fixture.virtualSource, { mode: row.fixture.mode });";
const newWrite = "await fs.writeFile(row.fixture.path, new TextEncoder().encode(row.fixture.virtualSource), { mode: row.fixture.mode });";
const oldHelper = blob(inputCommit, `${prefix}/product-row.mjs`).toString();
assert.equal(oldHelper.split(oldWrite).length, 2);
assert.equal(await readFile(resolve(owned, 'product-row-bytes-v2.mjs'), 'utf8'), oldHelper.replace(oldWrite, newWrite));
const oldProbe = blob(inputCommit, `${prefix}/probe.mjs`).toString();
assert.equal(await readFile(resolve(owned, 'probe-bytes-v2.mjs'), 'utf8'), oldProbe.replace("from './product-row.mjs'", "from './product-row-bytes-v2.mjs'"));
const frozenBefore = await frozenGuard();
const native = JSON.parse(await readFile(resolve(owned, 'native-aligned.json')));
async function nativeGuard() {
  const proof = {};
  for (const profile of native.profiles) for (const [path, expected] of [[profile.env, profile.envHash], [profile.bash, profile.bashHash]]) {
    const hash = sha256(await readFile(path)); assert.equal(hash, expected, path);
    proof[path] = { realpath: await realpath(path), sha256: hash };
  }
  return proof;
}
const nativeBefore = await nativeGuard();
const setupCorrection = {
  profile: 'Versioned byte-API fixture setup correction only; not an unchanged historical run or source fix',
  historyCommit, oldWrite, newWrite, versionedBefore,
  helperOriginalSha256: sha256(oldHelper), probeOriginalSha256: sha256(oldProbe),
  hostsUnchanged: historyBefore[`${prefix}/hosts.mjs`],
  hostSetupAudit: 'The frozen seven-host module has no writeFile call; existing output chunks already use Buffer. No analogous fixture string-to-byte misuse or host change.',
  fixtures: native.profiles[0].rows.filter(row => row.category === 'single-optional').map(row => {
    const intended = Buffer.from(row.fixture.virtualSource, 'utf8'), encoded = new TextEncoder().encode(row.fixture.virtualSource);
    assert.deepEqual(Buffer.from(encoded), intended);
    return { id: row.id, path: row.fixture.path, mode: row.fixture.mode, intendedHex: intended.toString('hex'), encodedHex: Buffer.from(encoded).toString('hex'), sha256: sha256(encoded), fixtureUnchanged: row.fixture };
  }),
};
assert.equal(setupCorrection.fixtures.length, 6);
const live = async () => ({ head: git(['rev-parse', 'HEAD']).toString().trim(), status: git(['status', '--porcelain=v1']).toString(), index: git(['diff', '--cached', '--name-only']).toString(), hashes: Object.fromEntries(await Promise.all(['src/commands/execution.ts', 'src/commands/internal.ts', 'src/shell/runtime.ts', 'src/contracts/command.ts', 'package.json', 'package-lock.json'].map(async path => [path, sha256(await readFile(resolve(root, path)))]))) });
const liveBefore = await live();
const parent = await realpath(await mkdtemp(resolve(tmpdir(), 'safe-bash-env-bytes-v2-')));
const archive = resolve(parent, 'project'); await mkdir(archive);
const sourcePaths = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'];
const tar = git(['archive', '--format=tar', sourceCommit, ...sourcePaths]);
execFileSync('/usr/bin/tar', ['-xf', '-', '-C', archive], { input: tar });
const committed = {};
for (const line of git(['ls-tree', '-r', sourceCommit, ...sourcePaths]).toString().trim().split('\n')) {
  const [mode, kind, object, path] = line.split(/\s+/u); assert.equal(kind, 'blob');
  const bytes = await readFile(resolve(archive, path)); assert.deepEqual(bytes, git(['cat-file', 'blob', object]));
  committed[path] = { mode, blob: object, sha256: sha256(bytes) };
}
assert.equal(committed['src/commands/execution.ts'].sha256, '1d084ab203dc59a510e39e5c71743b755ba9bdb5d4b018658398ed96c3dff700');
assert.equal(committed['src/shell/runtime.ts'].sha256, '2223ef9e02565d163ded042d933553a1efae502ce7531fe83bba5611d959c84b');
const copied = {};
for (const path of frozenPaths) {
  const bytes = blob(inputCommit, path); await mkdir(dirname(resolve(archive, path)), { recursive: true }); await writeFile(resolve(archive, path), bytes);
  copied[path] = frozenBefore[path];
}
for (const name of ['product-row-bytes-v2.mjs', 'probe-bytes-v2.mjs']) {
  const bytes = await readFile(resolve(owned, name)); assert.equal(sha256(bytes), versionedBefore[name]);
  await writeFile(resolve(archive, prefix, name), bytes);
  copied[`${prefix}/${name}`] = { sourcePath: `${prefix}/${name}`, version: 'bytes-v2', sha256: sha256(bytes) };
}
const traceBytes = blob(traceCommit, tracePath);
assert.deepEqual(await readFile(resolve(root, tracePath)), traceBytes);
const archivedTrace = resolve(archive, prefix, 'resume-trace.mjs'); await writeFile(archivedTrace, traceBytes);
copied[relative(archive, archivedTrace)] = { sourcePath: tracePath, commit: traceCommit, sha256: sha256(traceBytes) };
const devtools = await realpath(resolve(root, 'node_modules'));
await symlink(devtools, resolve(archive, 'node_modules'), 'dir');
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
const toolsBefore = tree(devtools), initial = tree(archive);
const sourceHashes = Object.fromEntries(Object.entries(committed).filter(([path]) => path.startsWith('src/')).map(([path, proof]) => [path, proof.sha256]));
const manifests = {};
const store = value => { const key = sha256(JSON.stringify(value)); manifests[key] = value; return key; };
const nativeRows = native.profiles[0].rows.filter(row => ['command', 'single-optional'].includes(row.category));
const hostIds = (await import('./hosts.mjs')).hostIds;
assert.equal(nativeRows.length, 48); assert.equal(hostIds.length, 7);
const requests = [...nativeRows.map(row => ({ kind: 'row', id: row.id, category: row.category })), ...hostIds.map(id => ({ kind: 'host', id }))];
const records = [];
const startedAt = new Date().toISOString();
let failure = null;
try {
  for (const [index, specimen] of requests.entries()) {
    const before = tree(archive), trace = resolve(parent, `loads-${index}.jsonl`), policyPath = resolve(parent, `policy-${index}.json`), requestPath = resolve(parent, `request-${index}.json`);
    await writeFile(policyPath, JSON.stringify({ files: { ...before, ...toolsBefore } }));
    const request = { ...specimen, archive, sourceCommit, sourceHashes };
    await writeFile(requestPath, JSON.stringify(request));
    const env = { PATH: '/nonexistent', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', CURRENT_SHELL_IMPORT_TRACE: '', PROFILE_REVIEW_POLICY: policyPath, PROFILE_REVIEW_TRACE: trace, NODE_OPTIONS: `--import=${pathToFileURL(archivedTrace).href}` };
    const args = ['--unhandled-rejections=strict', '--import', 'tsx', resolve(archive, prefix, 'probe-bytes-v2.mjs'), requestPath];
    const child = await runChild(process.execPath, args, { cwd: archive, env, deadline: 7000 });
    const after = tree(archive);
    const loads = existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    const problems = loads.filter(load => !load.valid || load.hash !== (before[load.path] ?? toolsBefore[load.path]) || load.hash !== (after[load.path] ?? toolsBefore[load.path]));
    const productLoads = loads.filter(load => load.path.startsWith(resolve(archive, 'src') + '/'));
    const productMismatches = productLoads.filter(load => committed[relative(archive, load.path)]?.sha256 !== load.hash);
    const guardValid = isDeepStrictEqual(before, after) && loads.length > 0 && problems.length === 0 && productMismatches.length === 0 && productLoads.some(load => load.path === resolve(archive, 'src/index.ts'));
    let parsed = null; try { parsed = JSON.parse(Buffer.from(child.stdout, 'base64').toString()); } catch {}
    const observation = parsed?.result?.result ?? null;
    let comparison = null;
    if (specimen.kind === 'row') {
      const reference = nativeRows.find(row => row.id === specimen.id && row.category === specimen.category);
      const expected = { status: reference.result.status, stdout: reference.result.stdout, stderr: reference.result.stderr, effects: reference.after };
      const actual = observation ? { ...observation.result, effects: observation.effects } : null;
      const fields = Object.fromEntries(Object.keys(expected).map(key => [key, isDeepStrictEqual(actual?.[key], expected[key])]));
      comparison = { profile: native.profiles[0].id, expected, actual, fields, exact: guardValid && transport(child) && child.status === 0 && Object.values(fields).every(Boolean) };
    }
    const record = { ...specimen, request, args, env, child, parsed, comparison, hostPassed: specimen.kind === 'host' && guardValid && transport(child) && child.status === 0 && observation?.passed === true, before: store(before), after: store(after), loads: store(loads), guard: { valid: guardValid, problems, productMismatches, actualLoads: loads.length, publicIndexLoads: productLoads.filter(load => load.path === resolve(archive, 'src/index.ts')).length }, observationAvailable: observation !== null };
    records.push(record);
    assert.ok(guardValid, `Import/source guard failed in slot ${index}; stop rather than retry`);
    if ((index + 1) % 12 === 0 || index === requests.length - 1) console.log(JSON.stringify({ completedSlots: index + 1, rowsExact: records.filter(row => row.comparison?.exact).length, hostPass: records.filter(row => row.hostPassed).length }));
  }
} catch (error) { failure = { name: error.name, message: error.message, stack: error.stack }; }
const endpoint = tree(archive), toolsAfter = tree(devtools), frozenAfter = await frozenGuard(), nativeAfter = await nativeGuard();
const historyAfter = await historyGuard(), versionedAfter = await versionedGuard();
assert.deepEqual(versionedAfter, versionedBefore);
const evidence = { setupCorrection, historyBefore, historyAfter, versionedAfter, startedAt, finishedAt: new Date().toISOString(), sourceCommit, inputCommit, nativeCapture: { file: 'native-aligned.json', sha256: sha256(await readFile(resolve(owned, 'native-aligned.json'))), reused: true, freshNativeExecutions: 0, comparedProfile: native.profiles[0].id, historicalProfile: 'Retained and binary-verified, not rebound to different cwd/env coordinates or selectively chosen as oracle.' }, sourceArchive: { parent, archive, tarSha256: sha256(tar), committed, copied, sourceHashes }, frozenBefore, frozenAfter, nativeBefore, nativeAfter, liveBefore, liveAfter: await live(), node: { path: process.execPath, version: process.version, sha256: sha256(await readFile(process.execPath)) }, initial: store(initial), endpoint: store(endpoint), toolsBefore: store(toolsBefore), toolsAfter: store(toolsAfter), manifests, records, failure, guard: { historyStable: isDeepStrictEqual(historyBefore, historyAfter), versionedStable: isDeepStrictEqual(versionedBefore, versionedAfter), sourceInputsStable: isDeepStrictEqual(initial, endpoint), toolsStable: isDeepStrictEqual(toolsBefore, toolsAfter), frozenStable: isDeepStrictEqual(frozenBefore, frozenAfter), nativeToolsStable: isDeepStrictEqual(nativeBefore, nativeAfter) }, denominators: { rows: 48, hosts: 7, executionsRequested: 55, executionsActual: records.length, rowsExact: records.filter(row => row.comparison?.exact).length, hostsPassed: records.filter(row => row.hostPassed).length, observationUnavailable: records.filter(row => !row.observationAvailable).length }, qualification: 'Only versioned fixture TextEncoder setup conversion plus probe import routing; unchanged frozen programs, native tuples and seven hosts; full committed public source, no live overlay. Red/missing observations retain denominator; no claim of implementation acceptance.' };
save(output, evidence);
await rm(parent, { recursive: true, force: true });
save('baseline-e7f4f2e-bytes-v2-cleanup.json', { parent, directoryRemoved: !existsSync(parent), allRecordedGroupsAbsent: records.every(record => !record.child.groupAlive), rawSha256: sha256(await readFile(resolve(owned, output))) });
console.log(JSON.stringify(evidence.denominators));
if (failure) throw new Error(failure.message);

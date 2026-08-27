import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const owned = dirname(fileURLToPath(import.meta.url)), root = resolve(owned, '../../..');
assert.equal(process.cwd(), root);
const output = process.argv[2];
assert.match(output ?? '', /^[a-z0-9-]+\.json$/u);
const cleanupOutput = output.replace(/\.json$/u, '-cleanup.json');
assert.equal(existsSync(resolve(owned, output)), false); assert.equal(existsSync(resolve(owned, cleanupOutput)), false);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hashFile = async path => hash(await readFile(path));
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const sourceCommit = '6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a';
const frozenCommit = 'aef76d0cede4804513200ec71d572ca99240ca0f';
const initialCommit = '17bbd47d3b7d1c372312ab45bb0f250fef68e0d9';
const readyPath = '/tmp/safe-bash-errexit-author-ready.txt';
const ready = await readFile(readyPath, 'utf8');
assert.ok(ready.includes(sourceCommit)); assert.match(ready, /SOURCE WRITE LEASE RELINQUISHED/u);
const immutable = {};
for (const commit of [frozenCommit, initialCommit]) {
  const paths = git('diff-tree', '--no-commit-id', '--name-only', '-r', commit, '--', relative(root, owned)).toString().trim().split('\n');
  assert.equal(paths.length, commit === frozenCommit ? 10 : 6);
  for (const path of paths) {
    const sha256 = hash(git('show', `${commit}:${path}`));
    assert.equal(await hashFile(resolve(root, path)), sha256, path);
    immutable[path] = { commit, sha256 };
  }
}
const helperPath = 'tests/shell-stress/current-shell/support.mjs';
const helperExpected = 'd7b278db709f869a03e5cce56c501011a1162465b03ecfc1663465b0163c6f8a';
assert.equal(await hashFile(resolve(root, helperPath)), helperExpected);
const { runChild } = await import(pathToFileURL(resolve(root, helperPath)).href);
const { cases, hostCases } = await import('./cases.mjs');
const { saveNewJson } = await import('./native.mjs');
const native = JSON.parse(await readFile(resolve(owned, 'native-frozen.json')));
const nativeTools = {};
for (const [path, expected] of Object.entries(native.before)) { nativeTools[path] = await hashFile(resolve(root, path)); assert.equal(nativeTools[path], expected); }
const archiveArgs = ['archive', '--format=tar', sourceCommit, 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json'];
const archiveBytes = git(...archiveArgs);
const entries = git('ls-tree', '-r', sourceCommit, '--', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json').toString().trim().split('\n');
const committedFiles = {};
for (const entry of entries) {
  const [metadata, path] = entry.split('\t');
  const [mode, type, blob] = metadata.split(' ');
  assert.equal(type, 'blob'); assert.ok(['100644', '100755'].includes(mode));
  committedFiles[path] = { mode, blob, sha256: hash(git('cat-file', 'blob', blob)) };
}
async function inventory(directory) {
  const files = {};
  async function visit(current) {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files[relative(directory, path)] = await hashFile(path);
      else if (!entry.isSymbolicLink()) throw new Error(`Unsupported inventory entry: ${path}`);
    }
  }
  await visit(directory);
  return files;
}
const startedAt = new Date().toISOString();
const liveInitial = { head: git('rev-parse', 'HEAD').toString().trim(), status: git('status', '--short').toString(), index: git('diff', '--cached', '--raw').toString() };
const toolchainRoot = await realpath(resolve(root, 'node_modules'));
const toolchainInitial = await inventory(toolchainRoot);
const node = { path: process.execPath, realpath: await realpath(process.execPath), version: process.version, sha256: await hashFile(process.execPath) };
const tools = { git: { version: git('--version').toString().trim(), path: '/usr/bin/git', sha256: await hashFile('/usr/bin/git') }, tar: { version: execFileSync('/usr/bin/tar', ['--version']).toString().trim(), path: '/usr/bin/tar', sha256: await hashFile('/usr/bin/tar') } };
const directory = await realpath(await mkdtemp('/tmp/safe-bash-errexit-committed-'));
const archiveRoot = resolve(directory, 'project');
const manifests = {}, rows = [], copyProof = {};
const store = value => { const key = hash(JSON.stringify(value)); manifests[key] = value; return key; };
let reportWritten = false;
try {
  await mkdir(archiveRoot);
  execFileSync('/usr/bin/tar', ['-xf', '-', '-C', archiveRoot], { input: archiveBytes, maxBuffer: 64 * 1024 * 1024 });
  const extracted = await inventory(archiveRoot);
  assert.deepEqual(Object.keys(extracted).sort(), Object.keys(committedFiles).sort());
  for (const [path, entry] of Object.entries(committedFiles)) { assert.equal(extracted[path], entry.sha256, path); assert.equal((await lstat(resolve(archiveRoot, path))).isSymbolicLink(), false); }
  const fixturePath = relative(root, owned);
  await mkdir(resolve(archiveRoot, fixturePath), { recursive: true });
  for (const name of ['cases.mjs', 'host.mjs', 'native-frozen.json', 'acceptance-product.mjs', 'isolated-trace.mjs']) {
    const path = `${fixturePath}/${name}`;
    const current = await hashFile(resolve(root, path));
    const proof = immutable[path] ?? { commit: null, sha256: current, role: 'New isolation-only import guard, no workload or expectation content' };
    assert.equal(current, proof.sha256);
    await copyFile(resolve(root, path), resolve(archiveRoot, path));
    assert.equal(await hashFile(resolve(archiveRoot, path)), proof.sha256);
    copyProof[path] = { ...proof, currentSha256: current, copySha256: proof.sha256 };
  }
  await symlink(toolchainRoot, resolve(archiveRoot, 'node_modules'));
  const symlinkIdentity = async () => ({ path: resolve(archiveRoot, 'node_modules'), target: await readlink(resolve(archiveRoot, 'node_modules')), realpath: await realpath(resolve(archiveRoot, 'node_modules')) });
  const toolSymlink = await symlinkIdentity();
  const policy = { sourceCommit, archiveRoot, liveRoot: root, toolchainRoot, archiveFiles: await inventory(archiveRoot), toolchainFiles: toolchainInitial };
  const policyPath = resolve(archiveRoot, '.holdout-isolation.json');
  await writeFile(policyPath, `${JSON.stringify(policy)}\n`);
  async function snapshot() { return { archive: await inventory(archiveRoot), toolchain: await inventory(toolchainRoot), toolSymlink: await symlinkIdentity() }; }
  const initial = await snapshot();
  for (const role of ['bash', 'sh', 'host']) {
    for (const specimen of role === 'host' ? hostCases : cases) {
      const before = await snapshot();
      const trace = resolve(directory, `${role}-${specimen.id}.jsonl`);
      const args = ['--unhandled-rejections=strict', '--import', resolve(archiveRoot, fixturePath, 'isolated-trace.mjs'), '--import', 'tsx', resolve(archiveRoot, fixturePath, 'acceptance-product.mjs'), role, specimen.id];
      const env = { PATH: '/nonexistent', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', CURRENT_SHELL_IMPORT_TRACE: '', ERREXIT_ISOLATION_POLICY: policyPath, ERREXIT_ISOLATION_TRACE: trace };
      const run = await runChild(process.execPath, args, { cwd: archiveRoot, env, deadline: 3000 });
      const after = await snapshot();
      const loads = (await readFile(trace, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      const loadIssues = loads.filter(load => !load.valid || load.liveSource || load.beforeHash !== load.hash || (load.category === 'toolchain' ? before.toolchain[load.key] !== load.hash || after.toolchain[load.key] !== load.hash : before.archive[load.key] !== load.hash || after.archive[load.key] !== load.hash));
      const committedIssues = Object.entries(committedFiles).filter(([path, expected]) => before.archive[path] !== expected.sha256 || after.archive[path] !== expected.sha256).map(([path]) => path);
      const changed = !isDeepStrictEqual(before, after);
      const loadedProduct = Object.fromEntries(loads.filter(load => load.category === 'product').map(load => [load.key, load.hash]));
      const fullPublicImport = ['src/index.ts', 'src/shell/runtime.ts', 'src/shell/parser.ts', 'src/commands/index.ts', 'src/commands/search/rg.ts', 'src/fs/webdav/webdav.ts'].every(path => loadedProduct[path] === committedFiles[path].sha256);
      let protocol;
      try { protocol = JSON.parse(Buffer.from(run.stdout, 'base64').toString()); } catch { protocol = { observation: { protocolError: true } }; }
      const transportValid = run.status === 0 && run.signal === null && !run.timedOut && !run.overflow && !run.groupAlive;
      const valid = transportValid && !changed && !loadIssues.length && !committedIssues.length && fullPublicImport && protocol.forbidden?.length === 0;
      const comparisons = role === 'host' ? [] : native.profiles.filter(profile => profile.role === role).map(profile => {
        const reference = profile.rows.find(row => row.id === specimen.id);
        const expected = { stdout: reference.result.stdout, stderr: reference.result.stderr, status: reference.result.status, effects: reference.effects };
        const assertions = Object.keys(expected).map(field => ({ field, pass: isDeepStrictEqual(protocol.observation?.[field], expected[field]) }));
        const rawPass = assertions.every(assertion => assertion.pass);
        return { profile: profile.id, expected, assertions, rawPass, accepted: valid && rawPass };
      });
      rows.push({ role, id: specimen.id, valid, transportValid, before: store(before), after: store(after), loads: store(loads), loadedProduct: store(loadedProduct), changed, loadIssues, committedIssues, fullPublicImport, actual: protocol.observation, launch: protocol.launch, forbidden: protocol.forbidden, comparisons, ...(role === 'host' ? { rawPass: protocol.observation?.pass === true, accepted: valid && protocol.observation?.pass === true } : {}), process: { executable: process.execPath, args, cwd: archiveRoot, env, deadlineMs: 3000, outputCapBytes: 1048576 }, run });
    }
    console.log(JSON.stringify({ completedRole: role, attempts: rows.filter(row => row.role === role).length, valid: rows.filter(row => row.role === role && row.valid).length, rawPrimaryOrHost: rows.filter(row => row.role === role && (role === 'host' ? row.rawPass : row.comparisons.find(comparison => comparison.profile.startsWith('gnu53')).rawPass)).length }));
  }
  const endpoint = await snapshot();
  const summary = native.profiles.map(profile => { const comparisons = rows.flatMap(row => row.comparisons.filter(comparison => comparison.profile === profile.id)); return { profile: profile.id, denominator: comparisons.length, rawExact: comparisons.filter(comparison => comparison.rawPass).length, accepted: comparisons.filter(comparison => comparison.accepted).length }; });
  summary.push({ profile: 'host', denominator: hostCases.length, rawExact: rows.filter(row => row.role === 'host' && row.rawPass).length, accepted: rows.filter(row => row.role === 'host' && row.accepted).length });
  const immutableEndpoint = {};
  for (const [path, proof] of Object.entries(immutable)) { immutableEndpoint[path] = await hashFile(resolve(root, path)); assert.equal(immutableEndpoint[path], proof.sha256); }
  const helperAfter = await hashFile(resolve(root, helperPath)); assert.equal(helperAfter, helperExpected);
  const report = { schema: 1, profile: 'full-committed-source-isolation-one-authorized-recovery', startedAt, finishedAt: new Date().toISOString(), sourceCommit, frozenCommit, initialCommit, ready: { path: readyPath, sha256: hash(ready), text: ready }, nativeReused: true, freshNativeRuns: 0, nativeSha256: await hashFile(resolve(owned, 'native-frozen.json')), nativeTools, uniqueProductAttempts: 108, nativeComparisons: 216, hostAttempts: 4, immutable, immutableEndpoint, archive: { root: archiveRoot, temporaryParent: directory, args: archiveArgs, tarSha256: hash(archiveBytes), extractedFileCount: Object.keys(extracted).length, sourceFileCount: Object.keys(extracted).filter(path => path.startsWith('src/')).length, committedFiles, copyProof, policySha256: await hashFile(policyPath), sourceOverlay: false, toolSymlink, toolchainRoot }, helper: { path: helperPath, before: helperExpected, after: helperAfter }, node, tools, driver: { path: relative(root, fileURLToPath(import.meta.url)), sha256: await hashFile(fileURLToPath(import.meta.url)) }, liveInitial, liveEndpoint: { head: git('rev-parse', 'HEAD').toString().trim(), status: git('status', '--short').toString(), index: git('diff', '--cached', '--raw').toString() }, initial: store(initial), endpoint: store(endpoint), archiveAndToolchainStable: isDeepStrictEqual(initial, endpoint), manifests, rows, summary, cleanup: { auditSavedBeforeCleanup: true, pendingReceipt: cleanupOutput, allGroupsAbsent: rows.every(row => { try { process.kill(-row.run.pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } }) } };
  saveNewJson(output, report);
  reportWritten = true;
  console.log(JSON.stringify({ output, summary, invalid: rows.filter(row => !row.valid).length, archiveAndToolchainStable: report.archiveAndToolchainStable, allGroupsAbsent: report.cleanup.allGroupsAbsent }));
  if (rows.some(row => !row.valid || (row.role === 'host' ? !row.rawPass : !row.comparisons.find(comparison => comparison.profile.startsWith('gnu53')).rawPass))) process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
  if (reportWritten) saveNewJson(cleanupOutput, { capturedAt: new Date().toISOString(), evidenceFile: output, evidenceSha256: await hashFile(resolve(owned, output)), directory, directoryRemoved: !existsSync(directory), allGroupsAbsent: rows.every(row => { try { process.kill(-row.run.pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } }) });
}

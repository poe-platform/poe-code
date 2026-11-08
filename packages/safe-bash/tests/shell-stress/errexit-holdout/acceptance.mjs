import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { runChild, sha256 } from '../current-shell/support.mjs';
import { cases, hostCases } from './cases.mjs';
import { saveNewJson } from './native.mjs';

const owned = dirname(fileURLToPath(import.meta.url)), root = resolve(owned, '../../..');
assert.equal(process.cwd(), root);
const output = process.argv[2];
assert.match(output ?? '', /^[a-z0-9-]+\.json$/u);
assert.equal(existsSync(resolve(owned, output)), false);
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const hash = async path => sha256(await readFile(resolve(root, path)));
const sourceCommit = '6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a';
const frozenCommit = 'aef76d0cede4804513200ec71d572ca99240ca0f';
const readyPath = '/tmp/safe-bash-errexit-author-ready.txt';
const ready = await readFile(readyPath, 'utf8');
assert.ok(ready.includes(sourceCommit)); assert.match(ready, /SOURCE WRITE LEASE RELINQUISHED/u);
git('merge-base', '--is-ancestor', sourceCommit, 'HEAD');
const expectedShell = { 'src/shell/runtime.ts': '5589f60a1db983538d37168e3b9276555ef71a2bc67446783535e47789f9d6eb', 'src/shell/parser.ts': '10d015eb62fd4e4f964666c04e5869ea78afdb76d930181760adecbcf16ab65e' };
for (const [path, expected] of Object.entries(expectedShell)) { assert.equal(await hash(path), expected); assert.equal(sha256(git('show', `${sourceCommit}:${path}`)), expected); }
const shellPaths = git('ls-tree', '-r', '--name-only', sourceCommit, '--', 'src/shell').toString().trim().split('\n');
const shellCommitted = {};
for (const path of shellPaths) { shellCommitted[path] = sha256(git('show', `${sourceCommit}:${path}`)); assert.equal(await hash(path), shellCommitted[path], path); }
const frozenPaths = git('ls-tree', '-r', '--name-only', frozenCommit, '--', relative(root, owned)).toString().trim().split('\n');
assert.equal(frozenPaths.length, 10);
const frozenFiles = {};
for (const path of frozenPaths) { frozenFiles[path] = sha256(git('show', `${frozenCommit}:${path}`)); assert.equal(await hash(path), frozenFiles[path], path); }
const native = JSON.parse(await readFile(resolve(owned, 'native-frozen.json'), 'utf8'));
const nativeToolsCurrent = {};
for (const [path, expected] of Object.entries(native.before)) { nativeToolsCurrent[path] = await hash(path); assert.equal(nativeToolsCurrent[path], expected); }
const fixedPaths = [...frozenPaths, ...['acceptance.mjs', 'acceptance-product.mjs', 'acceptance-trace.mjs'].map(name => relative(root, resolve(owned, name))), 'tests/shell-stress/current-shell/support.mjs', 'package.json', 'package-lock.json', 'tsconfig.json'];
async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile()) files.push(path);
    else if (entry.isSymbolicLink() && (await lstat(resolve(root, path))).isSymbolicLink() && !path.includes('/.bin/')) files.push(path);
  }
  return files;
}
async function snapshot() {
  const inventory = [...new Set([...await filesUnder('src'), ...await filesUnder('node_modules'), ...fixedPaths])].sort();
  return Object.fromEntries(await Promise.all(inventory.map(async path => [path, await hash(path)])));
}
const manifests = {}, rows = [], startedAt = new Date().toISOString();
const store = value => { const key = sha256(JSON.stringify(value)); manifests[key] = value; return key; };
const initial = await snapshot();
const initialHead = git('rev-parse', 'HEAD').toString().trim(), initialStatus = git('status', '--short').toString(), initialIndex = git('diff', '--cached', '--raw').toString();
const directory = await mkdtemp(resolve(owned, '.acceptance-'));
try {
  for (const role of ['bash', 'sh', 'host']) {
    for (const specimen of role === 'host' ? hostCases : cases) {
      const before = await snapshot(), trace = resolve(directory, `${role}-${specimen.id}.jsonl`);
      const args = ['--unhandled-rejections=strict', '--import', resolve(owned, 'acceptance-trace.mjs'), '--import', 'tsx', resolve(owned, 'acceptance-product.mjs'), role, specimen.id];
      const env = { PATH: '/nonexistent', HOME: '/nonexistent', LANG: 'C', LC_ALL: 'C', TZ: 'UTC', CURRENT_SHELL_IMPORT_TRACE: '', ERREXIT_HOLDOUT_TRACE: trace };
      const run = await runChild(process.execPath, args, { env, deadline: 3000 });
      const after = await snapshot();
      const loads = (await readFile(trace, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      const loaded = Object.fromEntries(loads.map(load => [relative(root, load.path), load.hash]));
      const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path] !== after[path]);
      const loadMismatches = loads.filter(load => before[relative(root, load.path)] !== load.hash || after[relative(root, load.path)] !== load.hash);
      const shellMismatches = Object.entries(shellCommitted).filter(([path, expected]) => before[path] !== expected || after[path] !== expected);
      let protocol;
      try { protocol = JSON.parse(Buffer.from(run.stdout, 'base64').toString()); } catch { protocol = { observation: { protocolError: true } }; }
      const transportValid = run.status === 0 && !run.signal && !run.timedOut && !run.overflow && !run.groupAlive;
      const valid = transportValid && !changed.length && !loadMismatches.length && !shellMismatches.length && Object.entries(expectedShell).every(([path, expected]) => loaded[path] === expected) && protocol.forbidden?.length === 0;
      const comparisons = role === 'host' ? [] : native.profiles.filter(profile => profile.role === role).map(profile => {
        const reference = profile.rows.find(row => row.id === specimen.id);
        const expected = { stdout: reference.result.stdout, stderr: reference.result.stderr, status: reference.result.status, effects: reference.effects };
        const assertions = Object.keys(expected).map(field => ({ field, pass: isDeepStrictEqual(protocol.observation?.[field], expected[field]) }));
        const rawPass = assertions.every(assertion => assertion.pass);
        return { profile: profile.id, expected, assertions, rawPass, accepted: valid && rawPass, referenceLaunch: { executable: reference.executable, argv0: reference.argv0, args: reference.args, commandName: reference.commandName, stdin: reference.stdin, cwd: reference.cwd, env: reference.env } };
      });
      rows.push({ role, id: specimen.id, valid, transportValid, before: store(before), after: store(after), loaded: store(loaded), loadCount: loads.length, changed, loadMismatches, shellMismatches, actual: protocol.observation, launch: protocol.launch, forbidden: protocol.forbidden, comparisons, ...(role === 'host' ? { rawPass: protocol.observation?.pass === true, accepted: valid && protocol.observation?.pass === true } : {}), process: { executable: process.execPath, args, env, deadlineMs: 3000, outputCapBytes: 1048576 }, run });
    }
    console.log(JSON.stringify({ completedRole: role, observations: rows.filter(row => row.role === role).length, valid: rows.filter(row => row.role === role && row.valid).length, exactPrimaryOrHost: rows.filter(row => row.role === role && (role === 'host' ? row.rawPass : row.comparisons.find(comparison => comparison.profile.startsWith('gnu53')).rawPass)).length }));
  }
} finally { await rm(directory, { recursive: true, force: true }); }
const endpoint = await snapshot();
const endpointDrift = [...new Set([...Object.keys(initial), ...Object.keys(endpoint)])].filter(path => initial[path] !== endpoint[path]);
const summary = native.profiles.map(profile => { const comparisons = rows.flatMap(row => row.comparisons.filter(comparison => comparison.profile === profile.id)); return { profile: profile.id, denominator: comparisons.length, rawExact: comparisons.filter(comparison => comparison.rawPass).length, accepted: comparisons.filter(comparison => comparison.accepted).length }; });
summary.push({ profile: 'host', denominator: hostCases.length, rawExact: rows.filter(row => row.role === 'host' && row.rawPass).length, accepted: rows.filter(row => row.role === 'host' && row.accepted).length });
const report = { schema: 1, startedAt, finishedAt: new Date().toISOString(), sourceCommit, frozenCommit, expectedShell, shellCommitted, ready: { path: readyPath, sha256: sha256(ready), text: ready }, nativeReused: true, freshNativeRuns: 0, nativeSha256: await hash(relative(root, resolve(owned, 'native-frozen.json'))), nativeToolsCurrent, frozenFiles, productObservations: 108, nativeComparisons: 216, hostObservations: 4, initialHead, endpointHead: git('rev-parse', 'HEAD').toString().trim(), initialStatus, endpointStatus: git('status', '--short').toString(), initialIndex, endpointIndex: git('diff', '--cached', '--raw').toString(), initial: store(initial), endpoint: store(endpoint), endpointDrift, manifests, rows, summary, cleanup: { directoryRemoved: !existsSync(directory), allGroupsAbsent: rows.every(row => { try { process.kill(-row.run.pid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } }) } };
saveNewJson(output, report);
console.log(JSON.stringify({ output, summary, endpointDrift, invalidRows: rows.filter(row => !row.valid).length, cleanup: report.cleanup }));
if (rows.some(row => !row.valid || (row.role === 'host' ? !row.rawPass : !row.comparisons.find(comparison => comparison.profile.startsWith('gnu53')).rawPass))) process.exitCode = 1;

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { runChild, sha256 } from '../current-shell/support.mjs';
import { nativeCases, hostCases, policy } from './cases.mjs';

const owned = dirname(fileURLToPath(import.meta.url)), root = resolve(owned, '../../..');
assert.equal(process.cwd(), root);
const output = process.argv[2]; assert.match(output ?? '', /^[a-z0-9-]+\.json$/); assert.ok(!existsSync(resolve(owned, output)));
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const hashFile = async path => sha256(await readFile(resolve(root, path)));
const readyPath = '/tmp/safe-bash-substring-author-ready.txt';
const ready = await readFile(readyPath, 'utf8');
assert.match(ready, /SOURCE WRITE LEASE RELINQUISHED/);
const sourceCommit = 'f1bb98b4ec8fd9cc198959e85f96e38880e72243'; assert.ok(ready.includes(sourceCommit));
git('merge-base', '--is-ancestor', sourceCommit, 'HEAD');
const expectedShell = { 'src/shell/runtime.ts': 'e8f1edb842d04498050d314091269974df157b11ab13cabba41d9c84a0191538', 'src/shell/parser.ts': 'feb6cbb2f03ec0c409adeb816bec506788fb3014a23c8dd02f4002362dc4b9f2' };
for (const [path, expected] of Object.entries(expectedShell)) { assert.equal(await hashFile(path), expected); assert.equal(sha256(git('show', `${sourceCommit}:${path}`)), expected); }
const frozenPaths = git('ls-tree', '-r', '--name-only', '29a6795', '--', relative(root, owned)).toString().trim().split('\n');
assert.equal(frozenPaths.length, 7);
const frozenFiles = Object.fromEntries(await Promise.all(frozenPaths.map(async path => { const expected = sha256(git('show', `29a6795:${path}`)); assert.equal(await hashFile(path), expected); return [path, expected]; })));
const nativePath = resolve(owned, 'native-frozen.json'), native = JSON.parse(await readFile(nativePath, 'utf8'));
for (const profile of native.profiles) assert.equal(sha256(await readFile(profile.binary)), profile.binarySha256);
assert.equal(sha256(await readFile('/usr/bin/locale')), native.localeTool.sha256);
assert.equal(await hashFile(native.helper.path), native.helper.sha256);
const fixedPaths = [...frozenPaths, relative(root, fileURLToPath(import.meta.url)), relative(root, resolve(owned, 'acceptance-product.mjs')), native.helper.path, 'tests/shell-stress/current-shell/acceptance-trace.mjs', 'package.json', 'package-lock.json', 'tsconfig.json', 'node_modules/tsx/package.json'];
const snapshot = async () => {
  const inventory = git('ls-files', '--cached', '--others', '--exclude-standard', 'src').toString().trim().split('\n').filter(Boolean);
  return Object.fromEntries(await Promise.all([...new Set([...inventory, ...fixedPaths])].sort().map(async path => [path, await hashFile(path)])));
};
const manifests = {}, rows = [], started = new Date().toISOString(), initial = await snapshot();
const store = value => { const key = sha256(JSON.stringify(value)); manifests[key] = value; return key; };
const initialHead = git('rev-parse', 'HEAD').toString().trim(), initialStatus = git('status', '--short').toString(), initialIndex = git('diff', '--cached', '--raw').toString();
const directory = await mkdtemp(resolve(owned, '.acceptance-'));
try {
  for (const profile of [...native.profiles, { id: 'host', rows: hostCases }]) {
    for (const [index, reference] of profile.rows.entries()) {
      const before = await snapshot(), trace = resolve(directory, `${profile.id}-${index}.jsonl`);
      const run = await runChild(process.execPath, ['--unhandled-rejections=strict', '--import', 'tsx', resolve(owned, 'acceptance-product.mjs'), profile.id, reference.id], { env: { ...policy.environment, LANG: profile.locale ?? 'C', LC_ALL: profile.locale ?? 'C', CURRENT_SHELL_IMPORT_TRACE: trace }, deadline: 8000 });
      const after = await snapshot();
      const loads = (await readFile(trace, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      const loaded = Object.fromEntries(loads.map(load => [relative(root, load.path), load.hash]));
      const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path] !== after[path]);
      const mismatches = loads.filter(load => before[relative(root, load.path)] !== load.hash || after[relative(root, load.path)] !== load.hash);
      let protocol; try { protocol = JSON.parse(Buffer.from(run.stdout, 'base64').toString()); } catch { protocol = { observation: { protocolError: true } }; }
      const valid = run.status === 0 && !run.signal && !run.timedOut && !run.overflow && !run.groupAlive && loaded['src/shell/runtime.ts'] === expectedShell['src/shell/runtime.ts'] && loaded['src/shell/parser.ts'] === expectedShell['src/shell/parser.ts'] && !changed.length && !mismatches.length && protocol.forbidden?.length === 0;
      const actual = protocol.observation;
      const assertions = profile.id === 'host' ? [] : policy.compare.map(field => ({ field, pass: isDeepStrictEqual(actual?.[field], reference.tuple[field]) }));
      const rawPass = profile.id === 'host' ? actual?.pass === true : assertions.every(assertion => assertion.pass);
      rows.push({ profile: profile.id, id: reference.id, valid, rawPass, accepted: valid && rawPass, assertions, expected: reference.tuple, actual, launch: protocol.launch, forbidden: protocol.forbidden,
        before: store(before), after: store(after), loaded: store(loaded), changed, mismatches, run });
    }
    const group = rows.filter(row => row.profile === profile.id);
    console.log(JSON.stringify({ profile: profile.id, exact: group.filter(row => row.rawPass).length, accepted: group.filter(row => row.accepted).length, denominator: group.length, invalid: group.filter(row => !row.valid).length }));
  }
} finally { await rm(directory, { recursive: true, force: true }); }
const endpoint = await snapshot();
const endpointDrift = [...new Set([...Object.keys(initial), ...Object.keys(endpoint)])].filter(path => initial[path] !== endpoint[path]);
const summary = [...native.profiles.map(profile => profile.id), 'host'].map(profile => { const group = rows.filter(row => row.profile === profile); return { profile, denominator: group.length, rawExact: group.filter(row => row.rawPass).length, accepted: group.filter(row => row.accepted).length, invalid: group.filter(row => !row.valid).length }; });
const report = { started, finished: new Date().toISOString(), sourceCommit, expectedShell, readiness: { path: readyPath, sha256: sha256(ready), text: ready }, nativeReused: true, nativeSha256: sha256(await readFile(nativePath)), frozenFiles, initialHead, endpointHead: git('rev-parse', 'HEAD').toString().trim(), initialStatus, endpointStatus: git('status', '--short').toString(), initialIndex, endpointIndex: git('diff', '--cached', '--raw').toString(),
  initial: store(initial), endpoint: store(endpoint), endpointDrift, manifests, rows, summary, cleanup: { directoryRemoved: !existsSync(directory), allGroupsAbsent: rows.every(row => { try { process.kill(-row.run.pid, 0); return false; } catch { return true; } }) } };
execFileSync('apply_patch', [], { cwd: root, input: `*** Begin Patch\n*** Add File: ${relative(root, resolve(owned, output))}\n${JSON.stringify(report, null, 2).split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, maxBuffer: 8 * 1024 * 1024 });
console.log(JSON.stringify({ output, summary, endpointDrift, cleanup: report.cleanup }));
if (rows.some(row => !row.accepted)) process.exitCode = 1;

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, '../../..');
const frozenCommit = 'a48b1e9dc8bcada35d1818ee569c3e74d90b9980';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('/usr/bin/git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
const prefix = 'tests/shell-stress/canonical-profile-review/';
const frozenPaths = git(['ls-tree', '-r', '--name-only', frozenCommit, prefix]).toString().trim().split('\n');
const helperPaths = [...frozenPaths, 'tests/shell-stress/current-shell/support.mjs'];
async function guard() {
  const proof = {};
  for (const path of helperPaths) {
    const blob = git(['rev-parse', `${frozenCommit}:${path}`]).toString().trim();
    const expected = hash(git(['cat-file', 'blob', blob]));
    const current = hash(await readFile(resolve(root, path)));
    assert.equal(current, expected, path);
    proof[path] = { blob, sha256: current };
  }
  return proof;
}
const beforeInputs = await guard();
const { runChild, save, snapshot, transport } = await import('./support.mjs');
const inputs = JSON.parse(await readFile(resolve(owned, 'inputs.json')));
const specimens = inputs.rows.filter(row => ['differential', 'syntax', 'gaps'].includes(row.cohort));
assert.equal(specimens.length, 88);
const nameControl = inputs.rows.find(row => row.id === 'control/name-line');
const profiles = [
  { id: 'gnu53', path: '/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash', sha256: '8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c' },
  { id: 'apple32', path: '/bin/bash', sha256: '35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3' },
];
const output = process.argv[2] ?? 'aligned-native-20260827.json';
assert.match(output, /^aligned-native-[a-z0-9-]+\.json$/u);
assert.equal(existsSync(resolve(owned, output)), false);
const toolPaths = [...profiles.map(profile => profile.path), '/bin/cat', '/usr/bin/head', process.execPath];
const toolGuard = async () => Object.fromEntries(await Promise.all(toolPaths.map(async path => [path, { realpath: await realpath(path), sha256: hash(await readFile(path)) }])));
const toolsBefore = await toolGuard();
for (const profile of profiles) assert.equal(toolsBefore[profile.path].sha256, profile.sha256);
assert.equal(process.umask(), 0o022, 'Record native umask022 without changing global state');
const directory = await realpath(await mkdtemp(resolve(owned, '.aligned-native-')));
const startedAt = new Date().toISOString();
const records = [];
const makeEnv = cwd => ({ PATH: '/usr/bin:/bin', HOME: cwd, TMPDIR: cwd, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' });
async function capture(profile, specimen, index) {
  assert.equal(specimen.role, 'bash');
  assert.ok(!specimen.source.includes('{{'));
  const cwd = resolve(directory, `${profile.id}-${index}`);
  await mkdir(cwd);
  const files = specimen.files;
  for (const fixture of files) {
    const path = resolve(cwd, fixture.path);
    assert.ok(path.startsWith(cwd + '/'));
    await mkdir(dirname(path), { recursive: true });
    if (fixture.directory) { await mkdir(path, { recursive: true }); if (fixture.mode !== 0o644) await chmod(path, fixture.mode); }
    else if (fixture.link) await symlink(fixture.link, path);
    else { await writeFile(path, fixture.hex === undefined ? Buffer.from(fixture.text ?? '') : Buffer.from(fixture.hex, 'hex')); await chmod(path, fixture.mode); }
  }
  const args = ['--noprofile', '--norc', '-c', specimen.source, 'shell'];
  const env = { ...makeEnv(cwd), ...specimen.env };
  const initial = await snapshot(cwd);
  const result = await runChild(profile.path, args, { argv0: 'bash', cwd, env, stdin: Buffer.from(specimen.stdinHex, 'hex'), deadline: 5000 });
  assert.ok(transport(result), specimen.id);
  const effects = await snapshot(cwd);
  await rm(cwd, { recursive: true });
  return { id: specimen.id, cohort: specimen.cohort, source: specimen.source, sourceSha256: hash(specimen.source), inputSha256: hash(JSON.stringify(specimen)), executable: profile.path, argv0: 'bash', args, commandName: 'shell', cwd, env, stdinHex: specimen.stdinHex, files, initial, result, effects };
}
try {
  for (const profile of profiles) {
    const version = await runChild(profile.path, ['--version'], { argv0: 'bash', cwd: directory, env: makeEnv(directory), deadline: 3000 });
    assert.ok(transport(version));
    const rows = [];
    for (const [index, specimen] of specimens.entries()) rows.push(await capture(profile, specimen, index));
    const control = await capture(profile, nameControl, 'name-line');
    assert.equal(Buffer.from(control.result.stdout, 'base64').toString(), 'name=shell\n');
    records.push({ ...profile, version, rows, existingNameLineControl: control });
  }
} finally { await rm(directory, { recursive: true, force: true }); }
const afterInputs = await guard();
const toolsAfter = await toolGuard();
assert.deepEqual(beforeInputs, afterInputs);
assert.deepEqual(toolsBefore, toolsAfter);
save(output, { schema: 1, phase: 'root-approved aligned-native preparation; candidate uninspected', frozenCommit, startedAt, completedAt: new Date().toISOString(), protocol: { argv0: 'bash', args: ['--noprofile', '--norc', '-c', 'ORIGINAL_SOURCE', 'shell'], nativeUmask: '0022', locale: 'C', deadlineMs: 5000, combinedOutputCapBytes: 1048576, processGroups: 'detached; deadline/close SIGKILL and group absence check', sourceRendering: 'none', bytesNormalization: 'none', cwdMapping: 'isolated native cwd corresponds to original direct virtual /; relative effects retained with modes' }, node: { version: process.version, platform: process.platform, arch: process.arch, executable: process.execPath }, beforeInputs, afterInputs, toolsBefore, toolsAfter, driverSha256: hash(await readFile(fileURLToPath(import.meta.url))), profiles: records, rowsPerProfile: 88, total: 176, extraExistingNameLineControls: 2, productExecutions: 0, nativeScratch: directory, directoryRemoved: !existsSync(directory) });
console.log(JSON.stringify({ nativeObservations: 176, existingNameLineControls: 2, productExecutions: 0, directoryRemoved: true }));

import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, mkdir, symlink } from 'node:fs/promises';
import { execFileSync, fork } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { hash, compare, environment, fixedTime } from '/Users/kjopek/Workspace/safe-bash/benchmarks/expanded/common.mjs';
import { recipes } from '/Users/kjopek/Workspace/safe-bash/benchmarks/expanded/recipes.mjs';
import { observeNative, executeNative } from '/Users/kjopek/Workspace/safe-bash/benchmarks/expanded/native.mjs';

const repo = '/Users/kjopek/Workspace/safe-bash';
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).trim();
const ids = ['command/patch/apply', 'command/patch/dry-run', 'command/patch/reverse', 'composition/patch-hash/patch-hash', 'command/stat/timestamp'];
const goldPath = 'benchmarks/reports/expanded-20260827/native-corrected/native.json';
const reportPath = 'benchmarks/reports/expanded-20260827/corrected-bd2cacb/report.json';
const functionalPath = 'benchmarks/reports/expanded-20260827/corrected-bd2cacb/functional.json';
const report = JSON.parse(await readFile(join(repo, reportPath), 'utf8'));
const goldBytes = await readFile(join(repo, goldPath));
const gold = JSON.parse(goldBytes);
const frozen = JSON.parse(await readFile(join(repo, functionalPath), 'utf8'));
assert.equal(hash(goldBytes), report.nativeGolden.sha256);

function save(path, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  execFileSync('apply_patch', [], { cwd: repo, input: `*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, maxBuffer: 32 * 1024 * 1024 });
}
async function state() {
  const hashes = {};
  async function visit(relative) {
    for (const entry of (await readdir(join(repo, relative), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(relative, entry.name);
      if (entry.isDirectory()) await visit(path); else hashes[path] = hash(await readFile(join(repo, path)));
    }
  }
  await visit('src');
  for (const root of ['tests/commands/diff-patch', 'tests/commands/metadata']) await visit(root);
  for (const path of [goldPath, reportPath, functionalPath, 'benchmarks/reports/expanded-20260827/ANALYSIS.md', ...Object.keys(report.harnessHashes).map(name => 'benchmarks/expanded/' + name)]) hashes[path] = hash(await readFile(join(repo, path)));
  return { at: new Date().toISOString(), head: git('rev-parse', 'HEAD'), dirty: git('status', '--short'), index: git('diff', '--cached', '--raw'), hashes };
}
const before = await state();
save('/tmp/safe-bash-routed-five-before.json', before);
const selected = ids.map(id => {
  const specimen = recipes().find(row => row.id === id);
  const expected = gold.observations.find(row => row.id === id);
  assert.equal(hash(JSON.stringify(specimen)), expected.recipeHash);
  assert.deepEqual(specimen, gold.recipes.find(row => row.id === id));
  assert.deepEqual(expected, frozen.find(row => row.id === id).expected);
  return { specimen, expected, frozen: frozen.find(row => row.id === id)['virtual-bash'] };
});
for (const [name, digest] of Object.entries(report.harnessHashes)) assert.equal(before.hashes['benchmarks/expanded/' + name], digest, `Frozen harness changed: ${name}`);
save('/tmp/safe-bash-routed-five-inputs.json', { environment, fixedTime, selected, frozenRevision: report.revision, harnessRevision: report.harnessRevision, sourceHashes: report.sourceHashes, nativeGolden: report.nativeGolden });
const workspace = await mkdtemp('/tmp/safe-bash-routed-five-native-');
const bin = join(workspace, 'bin');
await mkdir(bin);
const tools = {};
for (const name of ['bash', 'patch', 'stat', 'sha256sum', 'diff']) {
  const expected = gold.toolIdentities[name];
  assert.equal(hash(await readFile(expected.executable)), expected.sha256, `Native binary changed: ${name}`);
  await symlink(expected.executable, join(bin, name));
  const version = await executeNative(expected.executable, ['--version'], { cwd: workspace, env: { PATH: bin, LC_ALL: 'C', TZ: 'UTC' }, argv0: name });
  assert.equal(version.stdout.toString().slice(0, 512), expected.versionStdout);
  assert.equal(version.exitCode, expected.versionExit);
  tools[name] = { ...expected, verifiedHashAndVersion: true };
}
save(join(workspace, 'owned-sentinel.txt'), 'Owned by /tmp/safe-bash-routed-five-probe.mjs. Native cases only; unrelated native artifacts untouched.');
const profile = { workspace, bin, bash: tools.bash.executable };
const child = fork(join(repo, 'benchmarks/expanded/engine.mjs'), [], {
  cwd: repo, execArgv: ['--expose-gc', '--unhandled-rejections=strict', '--import', 'tsx', '--max-old-space-size=256'],
  env: { ...process.env, TSX_DISABLE_CACHE: '1', EXPANDED_ENGINE: 'virtual-bash', EXPANDED_SOURCE_ROOT: repo },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});
let logs = '';
child.stdout.on('data', bytes => { logs += bytes.toString(); });
child.stderr.on('data', bytes => { logs += bytes.toString(); });
const [ready] = await once(child, 'message');
assert.equal(ready.ready, true, ready.error);
const results = [];
try {
  for (const [index, row] of selected.entries()) {
    const responsePromise = once(child, 'message');
    child.send({ id: index + 1, specimen: row.specimen, instrument: true, warmup: 0 });
    const [response] = await responsePromise;
    const native = await observeNative(profile, row.specimen);
    const nativeMatchesFrozen = compare(row.expected, native);
    const currentMatchesFrozen = response.observation ? compare(row.expected, response.observation) : null;
    const currentMatchesHistorical = response.observation ? compare(row.frozen.observation, response.observation) : null;
    const label = response.error || !nativeMatchesFrozen.pass ? 'repro-blocked' : currentMatchesFrozen.pass ? 'already-fixed' : currentMatchesHistorical.pass ? 'still-fails' : 'current-differs';
    results.push({ id: row.specimen.id, label, recipeHash: row.expected.recipeHash, native, nativeMatchesFrozen, currentMatchesFrozen, currentMatchesHistorical, current: response });
    console.log(JSON.stringify({ id: row.specimen.id, label, nativeMatchesFrozen, currentMatchesFrozen }));
  }
} finally {
  const exited = once(child, 'exit');
  child.disconnect();
  const [code, signal] = await exited;
  assert.equal(code, 0); assert.equal(signal, null);
}
const after = await state();
save('/tmp/safe-bash-routed-five-after.json', after);
const changedPaths = Object.keys({ ...before.hashes, ...after.hashes }).filter(path => before.hashes[path] !== after.hashes[path]);
save('/tmp/safe-bash-routed-five-results.json', { startedAt: before.at, finishedAt: after.at, currentSource: repo, beforeHead: before.head, afterHead: after.head, dirtyBefore: before.dirty, dirtyAfter: after.dirty, indexUnchanged: before.index === after.index, changedPaths, tools, nativeWorkspace: workspace, nativeSentinelRetained: true, sourceHashesBefore: before.hashes, sourceHashesAfter: after.hashes, results, logs, nativeRunner: 'Unmodified observeNative; narrowed PATH links only to the five hash-verified relevant executables. Same fixed inputs, umask, environment, projection, compare.', engineRunner: 'Unmodified engine.mjs, same fork arguments and IPC specimen/instrument/warmup, normal IPC disconnect exit0; no benchmark orchestrator/full suite run.' });

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { root, owned, review, targets, sha, read, json, save, hashes, drift } from './archive.mjs';

const phase = process.argv[2];
assert.ok(['red', 'green', 'types'].includes(phase));
const historical = json(`${review}/snapshot-manifest.json`);
const paths = [...new Set([...Object.keys(historical.manifest).filter(path => path !== 'comm-review-types.json'), ...targets, `${owned}/archive.mjs`, `${owned}/run.mjs`, `${owned}/tsconfig.json`])];
const before = hashes(paths);
assert.equal(before['tests/fs/webdav/mock.ts'], historical.helperSha256, 'Require current matching helper');
for (const [path, expected] of Object.entries(historical.tableHashes)) assert.equal(before[path], expected, path);
const runtimeRelative = `${owned}/.runtime/${phase}`;
const runtime = resolve(root, runtimeRelative);
assert.ok(!existsSync(runtime));
save(`${runtimeRelative}/sentinel`, `obsolete-two-${phase}-owned\n`);
mkdirSync(join(runtime, 'tmp'));
mkdirSync(join(runtime, 'tests/commands/table-text-stress'), { recursive: true });
mkdirSync(join(runtime, 'tests/commands/metadata-stress'), { recursive: true });
symlinkSync(resolve(root, 'tests/commands/metadata-stress/.oracle'), join(runtime, 'tests/commands/metadata-stress/.oracle'));
symlinkSync(resolve(root, 'tests/commands/table-text-stress/first-discrepancy.json'), join(runtime, 'tests/commands/table-text-stress/first-discrepancy.json'));
const requireHere = createRequire(resolve(root, 'package.json'));
const resolutions = ['tsx', 'esbuild', '@esbuild/' + process.platform + '-' + process.arch + '/bin/esbuild', './node_modules/typescript/bin/tsc'].map(specifier => {
  const path = realpathSync(requireHere.resolve(specifier));
  return { specifier, path, sha256: sha(readFileSync(path)) };
});
const environment = { TSX_DISABLE_CACHE: '1', TMPDIR: join(runtime, 'tmp'), GNU_TABLE_BIN: resolve(root, 'tests/commands/metadata-stress/.oracle/coreutils-9.7/src'), LC_ALL: 'C' };
const commands = [];
function execute(name, args) {
  const result = spawnSync(process.execPath, args, { cwd: runtime, env: { ...process.env, ...environment }, timeout: 180000, maxBuffer: 32 * 1024 * 1024 });
  const stdout = result.stdout ?? Buffer.alloc(0), stderr = result.stderr ?? Buffer.alloc(0);
  const log = (stream, bytes) => {
    if (!bytes.length) return { path: null, bytes: 0, sha256: sha(bytes) };
    const path = `${owned}/logs/${phase}-${name}.${stream}`;
    save(path, bytes.toString());
    assert.equal(sha(read(path)), sha(bytes));
    return { path, bytes: bytes.length, sha256: sha(bytes) };
  };
  const text = stdout.toString();
  const record = { name, executable: process.execPath, args, cwd: runtime, environmentOverrides: environment, inheritedEnvironment: ['PATH', 'HOME', 'other parent variables; not a hermetic environment'], exitCode: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: log('stdout', stdout), stderr: log('stderr', stderr), pass: Number(text.match(/^# pass (\d+)/m)?.[1] ?? 0), fail: Number(text.match(/^# fail (\d+)/m)?.[1] ?? 0), skipped: Number(text.match(/^# skipped (\d+)/m)?.[1] ?? 0), failures: [...text.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1]) };
  commands.push(record);
  console.log(JSON.stringify(record));
}
const prefix = ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-reporter=tap'];
if (phase === 'types') execute('scoped-noemit', [resolve(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', resolve(root, owned, 'tsconfig.json')]);
else {
  execute('original104', [...prefix, ...historical.independentTests.map(path => resolve(root, path))]);
  execute('original311-current-helper', [...prefix, ...historical.authorTests.map(path => resolve(root, path))]);
}
const cleanup = [];
const corpus = json('tests/commands/table-text-stress/frozen-corpus.json');
const fixtureRoot = join(runtime, 'tests/commands/table-text-stress');
for (const name of readdirSync(fixtureRoot).filter(name => name.startsWith('.native-'))) {
  const directory = join(fixtureRoot, name);
  assert.equal(readFileSync(join(directory, 'sentinel'), 'utf8'), 'independent-table-text-owned');
  const files = Object.fromEntries(readdirSync(directory).filter(name => name !== 'sentinel').sort().map(name => [name, readFileSync(join(directory, name)).toString('hex')]));
  const match = corpus.find(entry => JSON.stringify(Object.fromEntries(Object.entries(entry.fixture.files).sort())) === JSON.stringify(files));
  assert.ok(match, name);
  cleanup.push({ path: directory, exactBytesAndNames: true, existingFixture: match.fixture.name });
}
const temporaryEntries = readdirSync(join(runtime, 'tmp'));
if (phase === 'types') assert.ok(temporaryEntries.every(name => name === 'node-compile-cache'));
else assert.deepEqual(temporaryEntries, []);
assert.equal(readFileSync(join(runtime, 'sentinel'), 'utf8'), `obsolete-two-${phase}-owned\n`);
const after = hashes(paths);
const record = { at: new Date().toISOString(), phase, headLabelOnly: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(), node: { version: process.version, executable: process.execPath, sha256: sha(readFileSync(process.execPath)) }, resolutions, commands, before, after, liveDuringRunDrift: drift(before, after), priorReviewToLiveDrift: drift(historical.manifest, before).filter(entry => entry.path !== 'comm-review-types.json'), sourceDigest: sha(JSON.stringify(Object.fromEntries(Object.entries(before).filter(([path]) => path.startsWith('src/'))))), helperSha256: before['tests/fs/webdav/mock.ts'], cleanup, tmpEntriesBeforeCleanup: temporaryEntries, remainingTmpEntries: [], runtimeCleanup: 'Verified owned sentinel, exact fixture namespaces/bytes and TMPDIR (empty for tests; only generated node-compile-cache permitted for types); removed only this fresh phase directory.', allChildrenExited: commands.every(command => command.signal === null && command.error === null), noRootBuildOrEmission: true };
rmSync(runtime, { recursive: true });
assert.ok(!existsSync(runtime));
save(`${owned}/${phase}-validation.json`, record);
assert.deepEqual(record.liveDuringRunDrift, []);
assert.ok(record.allChildrenExited);
for (const command of commands) {
  if (phase === 'types') assert.equal(command.exitCode, 0);
  else {
    const total = command.name === 'original104' ? 104 : 311;
    assert.equal(command.pass, total - Number(phase === 'red'));
    assert.equal(command.fail, Number(phase === 'red'));
    assert.equal(command.skipped, 0);
    assert.equal(command.exitCode, Number(phase === 'red'));
    assert.deepEqual(command.failures, phase === 'green' ? [] : [total === 104 ? 'independent frozen GNU: comm shared original' : 'explicit GNU duplicate-close disagreement comm: shared stdin']);
  }
}

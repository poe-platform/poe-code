import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessRepository, digest } from '../preflight-repair/preflight.mjs';
import { assessCommittedRevision, verifyFreshCommittedArchive } from './committed-archive.mjs';

const output = resolve(process.argv[2] ?? ''); assert.ok(process.argv[2]); assert.equal(existsSync(output), false);
const here = fileURLToPath(new URL('./', import.meta.url));
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'safe-bash-archive-admission-'));
const repository = join(temporary, 'repository'), archive = join(temporary, 'source');
mkdirSync(repository); mkdirSync(archive);
const environment = { ...process.env, HOME: temporary, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' };
const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], { cwd: repository, env: environment, maxBuffer: 4 * 1024 * 1024 }).toString();
const controls = [], children = [];
const record = (name, action) => { action(); controls.push({ name, status: 'pass' }); };
try {
  git('init', '--quiet', '--template=');
  for (const [path, bytes] of Object.entries({ 'src/index.ts': 'export const value = 1;\n', 'tests/one.test.ts': 'export {};\n', 'package.json': '{"name":"fixture","type":"module"}\n', 'tsconfig.json': '{}\n' })) {
    mkdirSync(dirname(join(repository, path)), { recursive: true }); writeFileSync(join(repository, path), bytes);
  }
  git('add', '--', 'src', 'tests', 'package.json', 'tsconfig.json');
  git('-c', 'user.name=Archive review fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'committed fixture');
  const candidate = git('rev-parse', 'HEAD').trim(), candidateTree = git('rev-parse', `${candidate}^{tree}`).trim();
  const scopeInputs = git('ls-tree', '-rz', candidate).split('\0').filter(Boolean).map(row => { const separator = row.indexOf('\t'), [mode, , blob] = row.slice(0, separator).split(' '); return { path: row.slice(separator + 1), mode, blob }; });
  const native = join(temporary, 'native'); writeFileSync(native, 'pinned development asset\n', { mode: 0o755 });
  const profile = { candidate, candidateTree, scope: 'isolated admission controls, no product execution', platform: process.platform, arch: process.arch,
    canonicalFiles: ['tests/one.test.ts'], scopeInputs, historicalBindings: [], blockedWriters: [], native: [{ name: 'fixture-tool', origin: native, sha256: digest(readFileSync(native)), executable: true }], environment: {} };
  const assess = override => assessCommittedRevision({ repository, candidate, profile, environment, ...override });
  const initial = assess(); record('clean committed revision admitted', () => assert.deepEqual(initial.issues, []));
  writeFileSync(join(repository, 'src/index.ts'), 'export const value = "foreign dirty";\n');
  git('add', '--', 'src/index.ts');
  writeFileSync(join(repository, 'src/untracked.ts'), 'throw new Error("untracked overlay");\n');
  record('dirty staged and untracked live product is not consumed', () => assert.deepEqual(assess().issues, []));
  record('existing live-worktree guard still refuses same dirty repository', () => assert.ok(assessRepository({ repository, candidate, profile, environment }).issues.some(entry => entry.kind === 'dirty-tracked-inputs')));
  const extract = () => {
    rmSync(archive, { recursive: true, force: true }); mkdirSync(archive);
    const bytes = execFileSync('git', ['--no-replace-objects', 'archive', candidate], { cwd: repository, env: environment });
    execFileSync('tar', ['-xf', '-', '-C', archive], { input: bytes, env: environment });
  };
  extract();
  const bound = verifyFreshCommittedArchive(archive, initial.entries);
  record('fresh archive uses exact committed bytes, not live dirty contents', () => {
    assert.equal(readFileSync(join(archive, 'src/index.ts'), 'utf8'), 'export const value = 1;\n');
    assert.equal(existsSync(join(archive, 'src/untracked.ts')), false); assert.equal(bound.count, 4);
  });
  for (const [name, mutate] of [
    ['source bytes', () => writeFileSync(join(archive, 'src/index.ts'), 'export const value = 2;\n')],
    ['package bytes', () => writeFileSync(join(archive, 'package.json'), '{}\n')],
    ['build config', () => writeFileSync(join(archive, 'tsconfig.json'), '{"changed":true}\n')],
    ['missing input', () => rmSync(join(archive, 'src/index.ts'))],
    ['untracked product overlay', () => writeFileSync(join(archive, 'src/extra.ts'), 'export {};\n')],
    ['untracked empty directory', () => mkdirSync(join(archive, 'extra'))],
    ['file mode', () => chmodSync(join(archive, 'src/index.ts'), 0o755)],
    ['source symlink', () => { rmSync(join(archive, 'src/index.ts')); symlinkSync(join(repository, 'src/index.ts'), join(archive, 'src/index.ts')); }],
    ['directory symlink', () => { rmSync(join(archive, 'src'), { recursive: true }); symlinkSync(join(repository, 'src'), join(archive, 'src')); }],
  ]) { extract(); mutate(); record('dirty archive rejects ' + name, () => assert.throws(() => verifyFreshCommittedArchive(archive, initial.entries))); }
  record('wrong frozen tree refuses', () => assert.ok(assess({ profile: { ...profile, candidateTree: '0'.repeat(40) } }).issues.length));
  record('wrong committed input binding refuses', () => assert.ok(assess({ profile: { ...profile, scopeInputs: [{ ...scopeInputs[0], blob: '0'.repeat(40) }] } }).issues.length));
  record('unknown candidate refuses', () => assert.ok(assess({ candidate: '0'.repeat(40) }).issues.length));
  const blob = scopeInputs.find(entry => entry.path === 'src/index.ts').blob;
  const object = join(repository, '.git/objects', blob.slice(0, 2), blob.slice(2)), held = join(temporary, 'held-object');
  renameSync(object, held);
  try { record('missing committed blob refuses before extraction', () => assert.ok(assess().issues.some(entry => entry.kind === 'committed-source-binding'))); }
  finally { renameSync(held, object); }
  chmodSync(native, 0o644);
  record('nonexecutable native still refuses', () => assert.ok(assess().issues.some(entry => entry.kind === 'native-unavailable-or-mismatched')));
  chmodSync(native, 0o755); writeFileSync(native, 'changed native\n');
  record('changed native still refuses', () => assert.ok(assess().issues.some(entry => entry.kind === 'native-unavailable-or-mismatched')));
  const actualProfile = JSON.parse(readFileSync(join(here, 'policy.json')));
  const actualEnvironment = { ...process.env, TREE_NATIVE_BIN: '/tmp/safe-bash-tree-external-oracle-TbVJVK/tree' };
  const actual = assessCommittedRevision({ repository: root, candidate: actualProfile.candidate, profile: actualProfile, environment: actualEnvironment });
  record('actual8670 object admission authenticates native49 independently of current worktree', () => { assert.deepEqual(actual.issues, []); assert.equal(actual.native.assets.length, 49); });
  const missingNative = { ...actualEnvironment }; delete missingNative.TREE_NATIVE_BIN;
  const noOutput = join('/tmp', `full-gate-archive-negative-${basename(temporary)}`);
  assert.equal(existsSync(noOutput), false);
  const rejected = spawnSync(process.execPath, [join(here, 'run.mjs'), '--handoff', actualProfile.candidate, '--execute', noOutput, '--committed-archive'], { cwd: root, env: missingNative, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  children.push({ status: rejected.status, signal: rejected.signal, error: rejected.error?.message, stdout: rejected.stdout, stderr: rejected.stderr });
  record('actual explicit mode missing-native route returns78 before output', () => { assert.equal(rejected.error, undefined); assert.equal(rejected.signal, null); assert.equal(rejected.status, 78); assert.equal(existsSync(noOutput), false); });
  const originalGuard = execFileSync('git', ['--no-replace-objects', 'show', '8670ebe8f0d39966c2de2638780437398e5f8490:tests/integration/full-gate-20260827/preflight-repair/preflight.mjs'], { cwd: root });
  record('global working-tree guard bytes unchanged', () => assert.deepEqual(readFileSync(join(here, '../preflight-repair/preflight.mjs')), originalGuard));
  writeFileSync(output, JSON.stringify({ date: new Date().toISOString(), candidate: actual.candidate, mode: 'committed-archive', controls, children,
    actual: { tree: actual.tree, inputCount: actual.entries.length, availableBlobs: actual.availableBlobs, native: actual.native.assets.length, status: actual.status },
    productExecutions: 0, compilerRuns: 0, wholeGateLaunched: false }, null, 2) + '\n', { flag: 'wx' });
} finally { rmSync(temporary, { recursive: true, force: true }); assert.equal(existsSync(temporary), false); }
console.log(JSON.stringify({ controls: controls.length, wholeGateLaunched: false, output }));

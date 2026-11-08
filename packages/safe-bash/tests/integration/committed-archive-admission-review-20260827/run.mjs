import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');
const author = '6699804ace9f5522aa67be6a017a8008bfc09f30';
const candidate = '8670ebe8f0d39966c2de2638780437398e5f8490';
const preparation = '85858fc37ecedf8d9fbcc3f753b957c362f4e44e';
const family = 'tests/integration/full-gate-20260827';
const successor = `${family}/combined-8670ebe8`;
const output = resolve(process.argv[2] ?? '');
assert.ok(process.argv[2]); assert.equal(existsSync(output), false);
mkdirSync(output, { recursive: true });
const temporary = realpathSync(mkdtempSync('/tmp/archive-independent-'));
const environment = { ...process.env, HOME: temporary, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1' };
delete environment.NODE_OPTIONS; delete environment.NODE_TEST_CONTEXT;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (args, cwd = repository) => execFileSync('git', ['--no-replace-objects', ...args], { cwd, env: environment, timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
const blob = (path, revision = author) => git(['show', `${revision}:${path}`]);
const write = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
const planBytes = blob('tests/integration/committed-archive-admission-independent-20260827/guard-cases.json', preparation);
write(join(output, 'frozen-cases.json'), planBytes);
const frozen = JSON.parse(planBytes);
assert.equal(frozen.cases.length, 18);
const report = { startedAt: new Date().toISOString(), author, candidate, preparation, frozenCasesSha256: hash(planBytes), node: { version: process.version, executableSha256: hash(readFileSync(process.execPath)), platform: process.platform, arch: process.arch }, cases: [], children: [], source: {}, mutants: [], wholeGateLaunched: false, productExecutions: 0, compilerRuns: 0, privateAccess: false };
const record = async (id, action) => {
  assert.ok(frozen.cases.some(entry => entry.id === id));
  try { const details = await action(); report.cases.push({ id, status: 'pass', details }); }
  catch (error) { report.cases.push({ id, status: 'fail', message: error.message, stack: error.stack }); }
  write(join(output, 'RESULT.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.cases.at(-1).status}: ${id}`);
};
const child = (name, args, options = {}) => {
  const result = spawnSync(process.execPath, args, { cwd: temporary, env: environment, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024, ...options });
  report.children.push({ name, args, status: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); return result;
};
const staged = join(temporary, 'harness');
const modules = ['combined-8670ebe8/run.mjs', 'combined-8670ebe8/committed-archive.mjs', 'combined-8670ebe8/prerequisites.mjs', 'combined-8670ebe8/import-guard.mjs', 'combined-8670ebe8/policy.json', 'combined-8670ebe8/CANDIDATE.json', 'combined-8670ebe8/cleanup-expected.json', 'preflight-repair/preflight.mjs', 'preflight-repair/policy.json', 'combined-b494675c/inspect.mjs', 'combined-b494675c/prerequisites.mjs', 'account.mjs', 'supervise.mjs', 'history.mjs'];
for (const path of modules) { const bytes = blob(`${family}/${path}`); write(join(staged, family, path), bytes); report.source[`${family}/${path}`] = hash(bytes); }
const archiveModule = join(staged, successor, 'committed-archive.mjs');
const preflightModule = join(staged, family, 'preflight-repair/preflight.mjs');
const { assessCommittedRevision, verifyFreshCommittedArchive } = await import(pathToFileURL(archiveModule));
const { assessRepository, launchAfterPreflight } = await import(pathToFileURL(preflightModule));
const runText = blob(`${successor}/run.mjs`).toString();
const mini = join(temporary, 'mini'), archive = join(temporary, 'mini-archive');
mkdirSync(mini);
git(['init', '--quiet', '--template='], mini);
const files = { 'src/index.ts': 'export const value = "committed";\n', 'tests/one.test.ts': 'export {};\n', 'evidence.txt': 'original evidence\n' };
for (const path of ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'benchmarks/package.json', 'benchmarks/package-lock.json', 'benchmarks/tsconfig.json']) files[path] = '{}\n';
files['package.json'] = '{"type":"module","name":"archive-independent-fixture"}\n';
for (const [path, bytes] of Object.entries(files)) write(join(mini, path), bytes);
git(['add', '--', '.'], mini);
git(['-c', 'user.name=Independent archive review', '-c', 'user.email=review@example.invalid', 'commit', '--quiet', '-m', 'pinned miniature'], mini);
const miniCommit = git(['rev-parse', 'HEAD'], mini).toString().trim();
const scopeInputs = git(['ls-tree', '-rz', miniCommit], mini).toString().split('\0').filter(Boolean).map(row => { const separator = row.indexOf('\t'), [mode, , blob] = row.slice(0, separator).split(' '); return { path: row.slice(separator + 1), mode, blob }; });
const native = join(temporary, 'native'); write(native, 'native-pin\n'); chmodSync(native, 0o755);
const profile = { candidate: miniCommit, candidateTree: git(['rev-parse', `${miniCommit}^{tree}`], mini).toString().trim(), scope: 'independent bounded miniature', scopeInputs, canonicalFiles: ['tests/one.test.ts'], historicalBindings: [], blockedWriters: [], platform: process.platform, arch: process.arch, native: [{ name: 'mini-native', origin: native, sha256: hash(readFileSync(native)), executable: true }], environment: {} };
const options = { repository: mini, candidate: miniCommit, profile, environment };
const assess = () => assessCommittedRevision(options);
const entries = assess().entries;
const extract = (revision = miniCommit) => {
  rmSync(archive, { recursive: true, force: true }); mkdirSync(archive);
  execFileSync('/usr/bin/tar', ['-xf', '-', '-C', archive], { input: git(['archive', revision], mini), env: environment, timeout: 30000 });
};
const cliRoot = join(temporary, 'mini');
for (const path of modules) write(join(cliRoot, family, path), blob(`${family}/${path}`));
write(join(cliRoot, successor, 'policy.json'), JSON.stringify(profile));
write(join(cliRoot, successor, 'CANDIDATE.json'), JSON.stringify({ candidate: miniCommit, tree: profile.candidateTree }));
const sentinel = join(temporary, 'sentinel.mjs');
write(sentinel, `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const original=fs.mkdirSync;fs.mkdirSync=(path,...args)=>{if(path===process.env.REVIEW_OUTPUT){fs.writeFileSync(process.env.REVIEW_RECEIPT,'admitted-before-output');process.exit(0);}return original(path,...args);};syncBuiltinESMExports();\n`);
const cli = (name, flags = [], extra = {}) => {
  const receipt = join(temporary, `${name}.receipt`), deniedOutput = `/tmp/full-gate-independent-${temporary.split('/').at(-1)}-${name}`;
  assert.equal(existsSync(deniedOutput), false);
  const result = child(name, ['--import', sentinel, join(cliRoot, successor, 'run.mjs'), '--handoff', miniCommit, '--execute', deniedOutput, ...flags], { cwd: cliRoot, env: { ...environment, REVIEW_OUTPUT: deniedOutput, REVIEW_RECEIPT: receipt, ...extra } });
  assert.equal(existsSync(deniedOutput), false);
  return { result, admitted: existsSync(receipt) };
};
let actual, fullManifest, later;
try {
  await record('strict-clean-positive', async () => {
    let launches = 0; await launchAfterPreflight(assessRepository(options), () => ++launches); assert.equal(launches, 1);
    const route = cli('strict-clean'); assert.equal(route.result.status, 0); assert.equal(route.admitted, true);
    return { actualUnmodifiedEntrypoint: true, boundary: 'fs.mkdirSync output intercepted before creating output, archive, private prerequisites or suite' };
  });
  write(join(mini, 'src/index.ts'), 'export const value = "DIRTY-LIVE";\n');
  await record('strict-dirty-refusal', async () => {
    const result = assessRepository(options); assert.ok(result.issues.some(entry => entry.kind === 'dirty-tracked-inputs'));
    let launches = 0; await assert.rejects(() => launchAfterPreflight(result, () => ++launches)); assert.equal(launches, 0);
    const route = cli('strict-dirty'); assert.equal(route.result.status, 78); assert.equal(route.admitted, false);
  });
  await record('archive-dirty-live-positive', () => {
    git(['add', '--', 'src/index.ts'], mini); assert.deepEqual(assess().issues, []); extract();
    assert.equal(verifyFreshCommittedArchive(archive, entries).count, Object.keys(files).length);
    assert.equal(readFileSync(join(archive, 'src/index.ts'), 'utf8'), files['src/index.ts']);
    const route = cli('archive-dirty', ['--committed-archive']); assert.equal(route.result.status, 0); assert.equal(route.admitted, true);
  });
  await record('archive-untracked-canary', async () => {
    const canary = 'throw new Error("LIVE-OVERLAY-MUST-NOT-LOAD");\n'; write(join(mini, 'src/untracked.ts'), canary); write(join(mini, 'foreign.config.json'), canary);
    const before = hash(readFileSync(join(mini, 'src/index.ts'))); extract(); verifyFreshCommittedArchive(archive, entries);
    assert.equal(existsSync(join(archive, 'src/untracked.ts')), false); assert.equal(existsSync(join(archive, 'foreign.config.json')), false);
    const loaded = await import(pathToFileURL(join(archive, 'src/index.ts'))); assert.equal(loaded.value, 'committed');
    assert.equal(readFileSync(join(mini, 'src/untracked.ts'), 'utf8'), canary); assert.equal(hash(readFileSync(join(mini, 'src/index.ts'))), before);
  });
  await record('moving-head-fixed-candidate', () => {
    git(['-c', 'user.name=Independent archive review', '-c', 'user.email=review@example.invalid', 'commit', '--quiet', '-m', 'later live revision'], mini);
    later = git(['rev-parse', 'HEAD'], mini).toString().trim(); assert.notEqual(later, miniCommit);
    assert.deepEqual(assess().entries, entries); extract(); verifyFreshCommittedArchive(archive, entries);
    const route = cli('moving-head', ['--committed-archive']); assert.equal(route.result.status, 0); assert.equal(route.admitted, true);
  });
  await record('changed-archive-code', () => {
    for (const path of ['src/index.ts', 'tests/one.test.ts', 'package.json']) { extract(); const bytes = readFileSync(join(archive, path)); bytes[0] ^= 1; write(join(archive, path), bytes); assert.throws(() => verifyFreshCommittedArchive(archive, entries), /Archive Git blob/u); }
    return { equalLengthCorruptions: 3 };
  });
  await record('missing-archive-input', () => {
    for (const path of ['src/index.ts', 'tests/one.test.ts', 'package.json']) { extract(); rmSync(join(archive, path)); assert.throws(() => verifyFreshCommittedArchive(archive, entries), /missing or extra input/u); }
    const selected = entries.find(entry => entry.path === 'tests/one.test.ts');
    const object = join(mini, '.git/objects', selected.blob.slice(0, 2), selected.blob.slice(2)), held = join(temporary, 'held-object'); renameSync(object, held);
    try { assert.ok(assess().issues.some(entry => entry.kind === 'committed-source-binding')); } finally { renameSync(held, object); }
  });
  await record('foreign-overlay', () => {
    for (const path of ['src/shadow.ts', 'foreign.config.json']) { extract(); write(join(archive, path), 'overlay'); assert.throws(() => verifyFreshCommittedArchive(archive, entries), /missing or extra input/u); }
    extract(); mkdirSync(join(archive, 'empty')); assert.throws(() => verifyFreshCommittedArchive(archive, entries), /extra directory/u);
    extract(); write(join(temporary, 'separate-generated/output.js'), 'allowed separate stage'); verifyFreshCommittedArchive(archive, entries);
  });
  await record('wrong-commit-archive', () => {
    extract(later); assert.throws(() => verifyFreshCommittedArchive(archive, entries));
    assert.ok(assessCommittedRevision({ ...options, candidate: later }).issues.length);
    assert.ok(assessCommittedRevision({ ...options, profile: { ...profile, candidateTree: '0'.repeat(40) } }).issues.length);
  });
  await record('changed-input-mode', () => { extract(); chmodSync(join(archive, 'src/index.ts'), 0o755); assert.throws(() => verifyFreshCommittedArchive(archive, entries), /Archive mode/u); });
  await record('active-file-symlink-escape', () => {
    extract(); const outside = join(temporary, 'outside.ts'); write(outside, files['src/index.ts']); rmSync(join(archive, 'src/index.ts')); symlinkSync(outside, join(archive, 'src/index.ts'));
    assert.throws(() => verifyFreshCommittedArchive(archive, entries), /Archive entry kind/u); assert.equal(readFileSync(outside, 'utf8'), files['src/index.ts']);
  });
  await record('active-directory-symlink-escape', () => {
    extract(); const outside = join(temporary, 'outside-dir'); write(join(outside, 'index.ts'), files['src/index.ts']); rmSync(join(archive, 'src'), { recursive: true }); symlinkSync(outside, join(archive, 'src'));
    assert.throws(() => verifyFreshCommittedArchive(archive, entries), /missing or extra input/u); assert.equal(readFileSync(join(outside, 'index.ts'), 'utf8'), files['src/index.ts']);
  });
  await record('post-phase-immutability', async () => {
    extract(); const expected = verifyFreshCommittedArchive(archive, entries).files;
    const implementation = runText.slice(runText.indexOf('function verifySource()'), runText.indexOf('function copyDependencies('));
    const fragment = join(temporary, 'post-phase.mjs');
    write(fragment, `import {lstatSync,readFileSync,readlinkSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';const hash=bytes=>createHash('sha256').update(bytes).digest('hex');export function check(source,sourceHashes){${implementation}\nreturn verifySource();}\n`);
    const { check } = await import(pathToFileURL(fragment)); assert.deepEqual(check(archive, expected), []);
    for (const path of ['src/index.ts', 'evidence.txt']) { extract(); write(join(archive, path), 'miniature phase mutation'); assert.deepEqual(check(archive, expected), [path]); }
    report.postPhaseSourceFragmentSha256 = hash(implementation);
    return { guard: 'verbatim verifySource function from frozen runner', expected: 'Git-authenticated pre-phase manifest', mutations: 2 };
  });
  const actualProfile = JSON.parse(blob(`${successor}/policy.json`));
  actual = assessCommittedRevision({ repository, candidate, profile: actualProfile, environment: { ...environment, TREE_NATIVE_BIN: '/tmp/safe-bash-tree-external-oracle-TbVJVK/tree' } });
  report.actualAdmission = { issues: actual.issues, entries: actual.entries?.length, blobs: actual.availableBlobs, native: actual.native.assets.length, tree: actual.tree };
  await record('native-guards-retained', () => {
    assert.deepEqual(actual.issues, []); assert.equal(actual.entries.length, 24879); assert.equal(actual.availableBlobs, 17765); assert.equal(actual.native.assets.length, 49);
    for (const mode of ['missing', 'changed', 'nonexec']) {
      write(native, 'native-pin\n'); chmodSync(native, 0o755);
      if (mode === 'missing') rmSync(native); else if (mode === 'changed') write(native, 'changed-pin\n'); else chmodSync(native, 0o644);
      for (const flag of [[], ['--committed-archive']]) { const route = cli(`native-${mode}-${flag.length}`, flag); assert.equal(route.result.status, 78); assert.equal(route.admitted, false); assert.match(route.result.stdout, /native-unavailable/u); }
    }
    write(native, 'native-pin\n'); chmodSync(native, 0o755);
    return { authenticatedAssets: actual.native.assets.map(entry => ({ name: entry.name, sha256: entry.actualSha256, executable: entry.executable })), deniedRoutes: 6 };
  });
  await record('cleanup-envelope-exact', async () => {
    assert.deepEqual(actual.issues, []);
    const full = join(temporary, 'actual-candidate'), tar = join(temporary, 'candidate.tar'); mkdirSync(full);
    git(['archive', '--format=tar', '-o', tar, candidate]);
    execFileSync('/usr/bin/tar', ['-xf', tar, '-C', full], { env: environment, timeout: 120000 });
    fullManifest = verifyFreshCommittedArchive(full, actual.entries);
    report.archive = { count: fullManifest.count, archiveSha256: hash(readFileSync(tar)), manifestSha256: hash(JSON.stringify(fullManifest)), bytes: actual.entries.reduce((total, entry) => total + entry.bytes, 0), symlinks: actual.entries.filter(entry => entry.mode === '120000').length };
    const cleanup = JSON.parse(blob(`${successor}/cleanup-expected.json`));
    assert.equal(Object.keys(cleanup.files).length, 220); assert.equal(hash(JSON.stringify(cleanup)), 'd9309d27efd2e1e418f075f4f514efeeefa833e8b3dc5e061662289f8ecd67b6');
    const { committedInputs } = await import(pathToFileURL(join(full, 'tests/shell-stress/invocation-cleanup-runtime/migration/replay.mjs')));
    assert.deepEqual(await committedInputs(candidate, repository), cleanup);
    for (const [path, expected] of Object.entries(cleanup.files)) assert.equal(fullManifest.files[path]?.sha256, expected);
    for (const variant of ['old-revision', 'changed-file', 'missing-file']) { const changed = structuredClone(cleanup); if (variant === 'old-revision') changed.revision = '0'.repeat(40); else if (variant === 'changed-file') changed.files['package.json'] = '0'.repeat(64); else delete changed.files['package.json']; assert.throws(() => assert.deepEqual(changed, cleanup)); }
    const testText = readFileSync(join(full, 'tests/shell/invocation-cleanup-public.test.ts'), 'utf8');
    const envChecks = testText.slice(testText.indexOf('  const expectedPath ='), testText.indexOf('  binding = await preparePublicSnapshot'));
    const fixture = join(temporary, 'cleanup-env.ts'); write(fixture, `import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';type CommittedInputs={revision:string};${envChecks}\nconsole.log('env-binding-accepted');\n`);
    const expectedPath = join(temporary, 'cleanup.json'); write(expectedPath, JSON.stringify(cleanup));
    for (const [name, supplied, status] of [['both', { VIRTUAL_BASH_PUBLIC_CLEANUP_EXPECTED: expectedPath, VIRTUAL_BASH_PUBLIC_CLEANUP_COMMIT: candidate }, 0], ['missing-commit', { VIRTUAL_BASH_PUBLIC_CLEANUP_EXPECTED: expectedPath }, 1], ['missing-manifest', { VIRTUAL_BASH_PUBLIC_CLEANUP_COMMIT: candidate }, 1], ['wrong-commit', { VIRTUAL_BASH_PUBLIC_CLEANUP_EXPECTED: expectedPath, VIRTUAL_BASH_PUBLIC_CLEANUP_COMMIT: '0'.repeat(40) }, 1]]) {
      const env = { ...environment }; delete env.VIRTUAL_BASH_PUBLIC_CLEANUP_EXPECTED; delete env.VIRTUAL_BASH_PUBLIC_CLEANUP_COMMIT;
      const result = child(`cleanup-${name}`, [fixture], { env: { ...env, ...supplied } }); assert.equal(result.status, status);
    }
    assert.match(runText, /environment\.VIRTUAL_BASH_PUBLIC_CLEANUP_COMMIT = discovery\.revision/u);
    assert.match(runText, /environment\.VIRTUAL_BASH_PUBLIC_CLEANUP_EXPECTED = join/u);
    const after = verifyFreshCommittedArchive(full, actual.entries); assert.deepEqual(after, fullManifest);
    write(join(output, 'ARCHIVE-MANIFEST.json'), JSON.stringify(fullManifest, null, 2) + '\n');
    report.cleanup = { inputs: 220, compactSha256: hash(JSON.stringify(cleanup)), environmentFragmentSha256: hash(envChecks), wholeGateRequiredVariablesSet: true, bothAbsentDevelopmentProfileNotCommittedQualification: true };
  });
  await record('source-load-guard-retained', () => {
    const source = join(temporary, 'load-source'); mkdirSync(source);
    const critical = { 'src/commands/execution.ts': 'export const first = 1;\n', 'src/commands/env-split.ts': 'export const second = 2;\n' };
    const expectedPath = join(temporary, 'load-expected.json'); write(expectedPath, JSON.stringify(Object.fromEntries(Object.entries(critical).map(([path, bytes]) => [path, hash(bytes)]))));
    const guard = join(staged, successor, 'import-guard.mjs');
    for (const mode of ['legitimate', 'old-source', 'missing-parser', 'compiled-fallback']) {
      for (const [path, bytes] of Object.entries(critical)) write(join(source, path), bytes);
      let mainText = "await import('./src/commands/execution.ts');await import('./src/commands/env-split.ts');console.log('executed');\n";
      if (mode === 'old-source') write(join(source, 'src/commands/execution.ts'), 'export const first = 0;\n');
      if (mode === 'missing-parser') rmSync(join(source, 'src/commands/env-split.ts'));
      if (mode === 'compiled-fallback') { write(join(source, 'src/commands/execution.js'), critical['src/commands/execution.ts']); mainText = "await import('./src/commands/execution.js');console.log('executed');\n"; }
      const main = join(source, 'main.mjs'); write(main, mainText);
      const logs = join(temporary, `load-${mode}`);
      const result = child(`load-${mode}`, ['--import', guard, main], { cwd: source, env: { ...environment, FULL_GATE_ROOT: temporary, FULL_GATE_SOURCE: source, FULL_GATE_EXPECTED: expectedPath, FULL_GATE_IMPORTS: logs, FULL_GATE_TOOL_ROOTS: '[]' } });
      if (mode === 'legitimate') { assert.equal(result.status, 0); const rows = readdirSync(logs).flatMap(name => readFileSync(join(logs, name), 'utf8').trim().split('\n').map(row => JSON.parse(row))); for (const path of Object.keys(critical)) { assert.ok(rows.some(row => row.relative === path && row.stage === 'resolve' && row.critical)); assert.ok(rows.some(row => row.relative === path && row.stage === 'load' && row.returnedSha256 === hash(critical[path]))); } }
      else { assert.equal(result.status, 1); assert.doesNotMatch(result.stdout, /executed/u); assert.match(result.stderr, mode === 'old-source' ? /Frozen env source bytes/u : mode === 'missing-parser' ? /ERR_MODULE_NOT_FOUND/u : /compiled-source fallback/u); }
    }
  });
  await record('mode-selection-fail-closed', () => {
    write(join(mini, 'evidence.txt'), 'new dirty');
    for (const flags of [[], ['--ignore-dirty'], ['--committed-archive', '--extra'], ['--committed-archive=false']]) { const route = cli(`mode-${flags.join('_') || 'missing'}`, flags, { IGNORE_DIRTY: '1' }); assert.notEqual(route.result.status, 0); assert.equal(route.admitted, false); }
    assert.deepEqual(blob(`${family}/preflight-repair/preflight.mjs`), blob(`${family}/preflight-repair/preflight.mjs`, candidate));
  });
  await record('guard-mutants', async () => {
    const preflightText = readFileSync(preflightModule, 'utf8');
    const dirtyStatement = 'if (dirty.length) report.issues.push({ kind: "dirty-tracked-inputs", records: dirty });'; assert.ok(preflightText.includes(dirtyStatement));
    const bypass = join(dirname(preflightModule), 'bypass-mutant.mjs'); write(bypass, preflightText.replace(dirtyStatement, ''));
    const mutant = await import(pathToFileURL(bypass)); const bypassed = mutant.assessRepository(options); assert.deepEqual(bypassed.issues, []);
    assert.throws(() => assert.ok(bypassed.issues.some(entry => entry.kind === 'dirty-tracked-inputs'))); report.mutants.push({ name: 'global-dirty-bypass', killedBy: 'strict-dirty-refusal' });
    const archiveText = readFileSync(archiveModule, 'utf8'); const line = archiveText.split('\n').find(value => value.includes("createHash('sha1').update")); assert.ok(line);
    const dropped = join(dirname(archiveModule), 'blob-mutant.mjs'); write(dropped, archiveText.replace(line, ''));
    const corrupt = await import(pathToFileURL(dropped)); extract(); const bytes = readFileSync(join(archive, 'src/index.ts')); bytes[0] ^= 1; write(join(archive, 'src/index.ts'), bytes);
    assert.throws(() => verifyFreshCommittedArchive(archive, entries), /Archive Git blob/u); corrupt.verifyFreshCommittedArchive(archive, entries);
    assert.throws(() => assert.throws(() => corrupt.verifyFreshCommittedArchive(archive, entries), /Archive Git blob/u)); report.mutants.push({ name: 'dropped-blob-authentication', killedBy: 'changed-archive-code equal-length corruption' });
    extract(); write(join(archive, 'src/index.ts'), readFileSync(join(mini, 'src/index.ts')));
    assert.throws(() => verifyFreshCommittedArchive(archive, entries)); assert.throws(() => assert.equal(readFileSync(join(archive, 'src/index.ts'), 'utf8'), files['src/index.ts']));
    report.mutants.push({ name: 'live-copy-substitution', killedBy: 'archive-dirty-live-positive committed-value assertion and Git identity' });
    assert.equal(report.mutants.length, 3);
  });
  for (const path of modules) assert.equal(hash(readFileSync(join(staged, family, path))), report.source[`${family}/${path}`]);
} catch (error) { report.executionBlocker = { message: error.message, stack: error.stack }; }
finally {
  rmSync(temporary, { recursive: true, force: true });
  report.cleanupComplete = !existsSync(temporary); report.finishedAt = new Date().toISOString();
  report.counts = { planned: 18, executed: report.cases.length, pass: report.cases.filter(entry => entry.status === 'pass').length, fail: report.cases.filter(entry => entry.status === 'fail').length, skips: 0, mutants: report.mutants.length };
  write(join(output, 'RESULT.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report.counts));
if (report.counts.pass !== 18 || report.executionBlocker) process.exitCode = 1;

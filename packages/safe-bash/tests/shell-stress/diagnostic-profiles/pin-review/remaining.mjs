import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';

const scope = dirname(fileURLToPath(import.meta.url));
const root = resolve(scope, '../../../..');
const candidate = 'e192662d2fda90104ab5a7e59c9b5c88bf5838c3';
const historical = 'eb602376d11f9d19cd22864027fe51f564944381';
const migration = '4fa20ac6cadb9d37fa9da4d205dc37a5a1bcb9f9';
const audit = '8cafed9bff7a8df1cf49b4ff4ef3ee021229ae3c';
const basePath = 'benchmarks/shell-stress/diagnostic-profiles/native-baseline.json';
const author = 'tests/shell-stress/diagnostic-profiles/pin-migration';
const compatibility = 'tests/shell-stress/diagnostic-profiles/compatibility.test.ts';
const profilePath = 'tests/shell-stress/diagnostic-profiles/profile.ts';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('/usr/bin/git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024, timeout: 20000 });
const show = (commit, path) => git(['show', `${commit}:${path}`]);
function save(name, value) {
  const path = join(scope, name);
  assert.equal(existsSync(path), false, 'Append-only evidence');
  const text = JSON.stringify(value, null, 2);
  execFileSync('apply_patch', [], { cwd: root, input: `*** Begin Patch\n*** Add File: ${relative(root, path)}\n${text.split('\n').map(line => '+' + line).join('\n')}\n*** End Patch\n`, maxBuffer: 64 * 1024 * 1024 });
}
assert.equal(existsSync(join(scope, 'remaining-execution.json')), false);
const helperPath = 'tests/shell-stress/current-shell/support.mjs';
const helperCommit = '303d18449c6e01bae4f33dada2f2022f95a56d49';
assert.deepEqual(readFileSync(join(root, helperPath)), show(helperCommit, helperPath));
const { runChild } = await import('../../current-shell/support.mjs');
const baseBytes = show(candidate, basePath), baseline = JSON.parse(baseBytes);
assert.equal(hash(baseBytes), '0cb9d0b498331434ec2a49dd4f75b30dcfb10db2ff8fd029613d948f119d4cf3');
assert.deepEqual(baseBytes, show(historical, basePath));
const bindings = [
  ['tests/shell-stress/differential.test.ts', '985d6e578841af649bbf4469fa69c48634070077baa9ecb85b60429da085e118', '59027400ad1ea3741e652c49a50b03e076bb2672bc2c24cbee5c994caef1ec32'],
  ['tests/shell-stress/current-gaps/compatibility.test.ts', '93f4d8dd5938ddba1464b126e5aec00c5304eacbd7470768e550301837dc4fa6', 'ddf404839fae525ae5ebc6d4241c09be307b4ab9359c099d7f7dac67e2c975ca'],
];
const drivers = bindings.map(([path, oldHash, newHash], index) => {
  const oldBytes = show(historical, path), newBytes = show(migration, path);
  assert.equal(hash(oldBytes), oldHash); assert.equal(hash(newBytes), newHash);
  assert.deepEqual(show(migration + '^', path), oldBytes);
  assert.deepEqual(show(candidate, path), newBytes);
  assert.equal(baseline.sources[path], oldHash);
  let expected = oldBytes.toString();
  if (index === 0) expected = expected.replace('import { bashVersion, runBash, runVirtualScript, sourceEvidence } from "./helpers.js";', 'import { runVirtualScript, sourceEvidence } from "./helpers.js";\nimport { primaryObservation as runBash, primaryVersion as bashVersion } from "./canonical-profile-migration/primary-reference.js";').replace('Bash differential:', 'GNU5.3 declared-profile differential:').replace('Bash parse-before-effects:', 'GNU5.3 declared-profile parse-before-effects:');
  else expected = expected.replace('import { independentBash } from "./reference.js";', 'import { primaryObservation as independentBash } from "../canonical-profile-migration/primary-reference.js";').replace('remaining-gap independent Bash:', 'remaining-gap GNU5.3 declared profile:');
  assert.equal(newBytes.toString(), expected, 'Complete driver changes exceed imports and declared labels');
  return { path, oldHash, newHash, oldBlob: git(['rev-parse', `${historical}:${path}`]).toString().trim(), newBlob: git(['rev-parse', `${migration}:${path}`]).toString().trim(), oldSource: oldBytes.toString(), newSource: newBytes.toString() };
});
const driverDiff = git(['diff', historical, migration, '--', ...bindings.map(row => row[0])]);
assert.deepEqual(driverDiff, show(candidate, `${author}/driver-delta.diff`));
assert.deepEqual(driverDiff, show(audit, 'tests/integration/current-type-diagnostics-20260827/evidence/audit/diagnostic-pin-migration.diff'));
const testPins = Object.entries(baseline.sources).filter(([path]) => path.startsWith('tests/'));
assert.equal(testPins.length, 14);
const pinProof = testPins.map(([path, oldHash]) => {
  const expected = bindings.find(row => row[0] === path)?.[2] ?? oldHash;
  assert.equal(hash(show(candidate, path)), expected, path);
  return { path, historical: oldHash, candidate: expected, migrated: oldHash !== expected };
});
assert.equal(pinProof.filter(pin => pin.migrated).length, 2);
const originalSuite = show(candidate + '^', compatibility).toString();
assert.equal(show(candidate, compatibility).toString(), originalSuite.replaceAll('validateFrozenProfile', 'validateCurrentProfile'));
const oldProfile = show(candidate + '^', profilePath).toString();
const newProfile = show(candidate, profilePath).toString();
assert.equal(newProfile.slice(newProfile.indexOf('export async function runNative')), oldProfile.slice(oldProfile.indexOf('export async function runNative')));
assert.equal(newProfile.slice(0, newProfile.indexOf('export function validateFrozenProfile')).replace('import { nativeCaptureSha256, validateSourceBindings } from "./pin-migration/current-binding.js";\n', ''), oldProfile.slice(0, oldProfile.indexOf('export function validateFrozenProfile')));
const authentication = JSON.parse(show(candidate, `${author}/authentication.json`));
const auditRows = JSON.parse(show(audit, 'tests/integration/current-type-diagnostics-20260827/evidence/audit/hash-guards.json')).failedRows.filter(row => row.group === 'historical-diagnostic-pin');
assert.equal(auditRows.length, 89);
const originalProof = authentication.originalFailureEvidence;
const stored = show(originalProof.reportCommit, `tests/integration/full-gate-20260827/combined-b494675c/${originalProof.capture.path}`);
assert.equal(hash(stored), originalProof.capture.storedSha256);
const originalLog = gunzipSync(Buffer.from(stored.toString().trim(), 'base64'));
assert.equal(hash(originalLog), originalProof.capture.originalSha256);
const excerpt = Buffer.concat(originalProof.excerpts.map((row, index) => {
  assert.equal(row.name, auditRows[index].name);
  const bytes = originalLog.subarray(row.start, row.stop);
  assert.equal(hash(bytes), row.sha256);
  assert.ok(bytes.toString().startsWith(`# Subtest: ${row.name}\nnot ok `));
  assert.ok(bytes.toString().includes("failureType: 'hookFailed'"));
  return bytes;
}));
assert.deepEqual(excerpt, show(candidate, `${author}/original-89.tap`));
const canonicalRoot = 'tests/shell-stress/canonical-profile-migration';
const metadataBytes = show(candidate, `${canonicalRoot}/primary-fixtures.json`);
const canonicalBytes = show(candidate, `${canonicalRoot}/native.json`);
assert.equal(hash(metadataBytes), '76204fc288836d2cde65156ee2d2f610d9ac31466414cc4ef2ec520284d72ec8');
assert.equal(hash(canonicalBytes), 'de379916112faa3cec68f3180b5ba55758eda415f2016456d448f635c9871bf5');
const metadata = JSON.parse(metadataBytes), canonical = JSON.parse(canonicalBytes);
const originals = baseline.captures.find(capture => capture.profile === 'primary-5.3' && capture.argv0 === 'shell' && capture.repetition === 1).rows;
const canonicalRows = canonical.rows.filter(row => row.profile === 'GNU5.3-primary' && row.invocationName === 'shell');
assert.equal(canonicalRows.length, 88);
assert.deepEqual(metadata.fixtures.map(row => row.fixture), originals.map(row => row.fixture));
for (const [index, row] of canonicalRows.entries()) {
  const expected = originals[index];
  assert.equal(row.source, expected.fixture.script); assert.equal(row.sourceSha256, hash(row.source));
  assert.equal(row.inputHex, Buffer.from(expected.fixture.stdin ?? '').toString('hex'));
  assert.deepEqual(row.args, expected.args);
  const files = Object.fromEntries(Object.entries(row.after).map(([path, entry]) => [path, entry.type === 'directory' ? { type: 'directory' } : { type: 'file', base64: Buffer.from(entry.hex, 'hex').toString('base64') }]));
  assert.deepEqual({ stdoutBase64: Buffer.from(row.stdoutHex, 'hex').toString('base64'), stderrBase64: Buffer.from(row.stderrHex, 'hex').toString('base64'), exitCode: row.status, files }, { stdoutBase64: expected.observation.stdoutBase64, stderrBase64: expected.observation.stderrBase64, exitCode: expected.observation.exitCode, files: expected.observation.files });
}
save('remaining-authentication.json', { checkedAt: new Date().toISOString(), candidate, historical, migration, audit, authorThread: '01a04314-dda5-7233-a841-0bc7a1533906', authorHeaderSource: '/tmp/safe-bash-diagnostic-pins-author.log', baselineHash: hash(baseBytes), drivers, driverDiff: driverDiff.toString(), guardDiff: git(['diff', candidate + '^', candidate, '--', profilePath, compatibility]).toString(), pinProof, originalHookFailureCount: auditRows.length, originalExcerptSha256: hash(excerpt), originalCapture: originalProof.capture, oldFailureRows: auditRows, canonicalFixtureAndTupleCrosswalk: 88, profileChanged: { old: '/bin/bash3.2 live -c ORIGINAL_SOURCE shell-stress', canonicalSibling: 'frozen GNU5.3 -c ORIGINAL_SOURCE shell; not live native', diagnosticSuite: 'unchanged explicit whole5.3 and3.2 profiles, live native then product compared with sealed shell-name tuples', modesAsserted: false }, helper: { path: helperPath, commit: helperCommit, sha256: hash(show(helperCommit, helperPath)) } });

function tree(directory) {
  const files = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(files, tree(path));
    else { assert.ok(entry.isFile() && !lstatSync(path).isSymbolicLink(), `Regular archive inputs only: ${path}`); files[path] = hash(readFileSync(path)); }
  }
  return files;
}
const roots = ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', basePath, ...testPins.map(([path]) => path), 'tests/shell-stress/virtual-child.ts', compatibility, profilePath, `${author}/current-binding.ts`, `${author}/binding.test.ts`];
const paths = git(['ls-tree', '-r', '--name-only', candidate, '--', ...roots]).toString().trim().split('\n');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'safe-bash-diagnostic-pin-remaining-')));
const project = join(scratch, 'project'), temp = join(scratch, 'tmp'); mkdirSync(project); mkdirSync(temp);
const inputProof = {};
for (const path of paths) {
  const bytes = show(candidate, path); mkdirSync(dirname(join(project, path)), { recursive: true }); writeFileSync(join(project, path), bytes);
  inputProof[path] = { blob: git(['rev-parse', `${candidate}:${path}`]).toString().trim(), sha256: hash(bytes), currentSha256: existsSync(join(root, path)) ? hash(readFileSync(join(root, path))) : null };
}
const tools = {};
for (const packagePath of ['tsx', 'esbuild', `@esbuild/${process.platform}-${process.arch}`]) {
  const source = join(root, 'node_modules', packagePath), target = join(project, 'node_modules', packagePath);
  const before = tree(source); cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
  for (const [path, expected] of Object.entries(before)) assert.equal(hash(readFileSync(join(target, relative(source, path)))), expected);
  tools[packagePath] = { source, version: JSON.parse(readFileSync(join(source, 'package.json'))).version, before };
}
const tracer = join(project, 'pin-review-trace.mjs'); writeFileSync(tracer, readFileSync(join(scope, 'trace.mjs')));
const nativeBefore = baseline.profiles.map(profile => { assert.equal(hash(readFileSync(profile.executable)), profile.sha256); return { ...profile, realpath: realpathSync(profile.executable) }; });
const live = () => ({ head: git(['rev-parse', 'HEAD']).toString().trim(), status: git(['status', '--short']).toString(), index: git(['diff', '--cached', '--name-only']).toString() });
const liveBefore = live(), initial = tree(project), startedAt = new Date().toISOString();
const manifests = {}, runs = [];
const store = value => { const key = hash(JSON.stringify(value)); manifests[key] = value; return key; };
const alive = pid => { try { process.kill(-pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
async function run(label, args, profile = 'primary-5.3', extraEnv = {}) {
  const before = tree(project), trace = join(scratch, `${label}.jsonl`), policyPath = join(scratch, `${label}-policy.json`);
  writeFileSync(policyPath, JSON.stringify({ files: before, esbuild: join(project, 'node_modules', `@esbuild/${process.platform}-${process.arch}`, 'bin/esbuild') }));
  const env = { PATH: '/usr/bin:/bin', HOME: temp, TMPDIR: temp, LANG: 'C', LC_ALL: 'C', TZ: 'UTC', TSX_DISABLE_CACHE: '1', CURRENT_SHELL_IMPORT_TRACE: '', VIRTUAL_BASH_DIAGNOSTIC_PROFILE: profile, PIN_REVIEW_POLICY: policyPath, PIN_REVIEW_TRACE: trace, NODE_OPTIONS: `--import=${pathToFileURL(tracer).href}`, ...extraEnv };
  const child = await runChild(process.execPath, args, { cwd: project, env, deadline: 180000 });
  const rawTrace = existsSync(trace) ? readFileSync(trace) : Buffer.alloc(0);
  const events = rawTrace.toString().trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const after = tree(project), loads = events.filter(event => event.kind === 'load');
  const invalid = loads.filter(load => !load.valid || load.before !== before[load.path] || load.after !== after[load.path]);
  const spawns = events.filter(event => event.kind === 'spawn'), nativeSpawns = spawns.filter(event => baseline.profiles.some(profile => event.command === profile.executable));
  const virtualSpawns = spawns.filter(event => event.command === process.execPath && event.args.some(arg => arg.endsWith('/virtual-child.ts')));
  const groups = spawns.filter(event => event.detached && event.pid).map(event => ({ pid: event.pid, alive: alive(event.pid) }));
  const text = Buffer.from(child.stdout, 'base64').toString();
  const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => [key, Number(text.match(new RegExp(`^# ${key} (\\d+)$`, 'mu'))?.[1] ?? -1)]));
  const rows = [...text.matchAll(/^(not ok|ok) \d+ - (.+)$/gmu)].map(match => ({ passed: match[1] === 'ok', name: match[2] }));
  const record = { label, args, env, child, counts, rows, hookFailures: (text.match(/failureType: 'hookFailed'/gu) ?? []).length, before: store(before), after: store(after), trace: { sha256: hash(rawTrace), bytes: rawTrace.length, gzipBase64: gzipSync(rawTrace).toString('base64') }, loads: loads.length, publicIndexLoads: loads.filter(load => load.path === join(project, 'src/index.ts')).length, invalid, nativeSpawns: nativeSpawns.length, virtualSpawns: virtualSpawns.length, groups, guard: isDeepStrictEqual(before, after) && loads.length > 0 && invalid.length === 0 && groups.every(group => !group.alive) && !child.timedOut && !child.overflow && !child.groupAlive };
  runs.push(record); assert.ok(record.guard, `${label} source/import/lifecycle guard failed`);
  console.log(JSON.stringify({ label, status: child.status, counts, hookFailures: record.hookFailures, native: record.nativeSpawns, virtual: record.virtualSpawns }));
  return record;
}
const suiteArgs = ['--import', 'tsx', '--test', '--test-reporter=tap', compatibility];
function complete(record) {
  assert.equal(record.counts.tests, 89); assert.equal(record.rows.length, 89);
  assert.equal(record.counts.pass + record.counts.fail, 89);
  for (const key of ['cancelled', 'skipped', 'todo']) assert.equal(record.counts[key], 0);
  for (const [cohort, total] of [['original-differential',72], ['original-syntax',5], ['current-gaps',11]]) assert.equal(record.rows.filter(row => row.name.includes(`: ${cohort}: `)).length, total);
}
let failure = null;
try {
  for (const [index, driver] of drivers.entries()) {
    const destination = join(project, driver.path), bytes = readFileSync(destination);
    try {
      writeFileSync(destination, Buffer.concat([bytes, Buffer.from('\n')]));
      const record = await run(`mutated-driver-${index+1}`, suiteArgs); complete(record);
      assert.equal(record.hookFailures, 89); assert.equal(record.counts.fail, 89); assert.equal(record.child.status, 1);
      assert.equal(record.nativeSpawns, 0); assert.equal(record.virtualSpawns, 0);
      assert.ok(Buffer.from(record.child.stdout, 'base64').toString().includes(`Current fixture/helper binding changed: ${driver.path}`));
    } finally { writeFileSync(destination, bytes); }
  }
  const guardScript = mode => `import assert from 'node:assert/strict'; import {validateCurrentProfile,validateFrozenProfile} from './${profilePath}'; ${mode === 'historical' ? "validateFrozenProfile(); assert.throws(validateCurrentProfile,/Current fixture\\/helper binding changed/);" : "validateCurrentProfile(); assert.throws(validateFrozenProfile,/Frozen historical fixture\\/helper changed/);"} console.log('Both-direction binding distinction verified: ${mode}');`;
  const currentGuard = await run('current-guard-not-historical', ['--import','tsx','--input-type=module','-e',guardScript('current')]); assert.equal(currentGuard.child.status,0);
  for (const driver of drivers) writeFileSync(join(project,driver.path),show(historical,driver.path));
  try {
    const replay = await run('historical-guard-not-current', ['--import','tsx','--input-type=module','-e',guardScript('historical')]); assert.equal(replay.child.status,0);
  } finally { for (const driver of drivers) writeFileSync(join(project,driver.path),show(candidate,driver.path)); }
} catch (error) { failure = { name: error.name, message: error.message, stack: error.stack }; }
const endpoint = tree(project), nativeAfter = baseline.profiles.map(profile => ({ path: profile.executable, sha256: hash(readFileSync(profile.executable)) }));
const toolsAfter = Object.fromEntries(Object.entries(tools).map(([name, tool]) => [name, tree(tool.source)]));
const liveAfter = live();
const evidence = { continuation: { initialSha256: 'b7e137d9a34e0577d6597fbc5dd262fb6b7c7fec1ea2fca00ac29de17b02f910', initialRunsRetained: ['primary-5.3','historical-3.2','six-binding-controls'], purpose: 'Only previously unexecuted required mutant and guard phases; no suite/control retry or candidate correction' }, candidate, historical, migration, startedAt, finishedAt: new Date().toISOString(), scratch, project, inputProof, node: { path: process.execPath, version: process.version, sha256: hash(readFileSync(process.execPath)) }, tools, toolsAfter, nativeBefore, nativeAfter, nativeUtilities: Object.fromEntries(['/bin/cat','/usr/bin/head'].map(path=>[path,hash(readFileSync(path))])), parentUmask:process.umask(), initial:store(initial), endpoint:store(endpoint), manifests, runs, liveBefore, liveAfter, reviewerInputs: Object.fromEntries(['review.mjs','trace.mjs','remaining.mjs'].map(name=>[name,hash(readFileSync(join(scope,name)))])), failure, endpointStable:isDeepStrictEqual(initial,endpoint), copiedToolsRegular:true, historicalControlGitMetadata:'Only six-control git show reads fixed historical commit from original read-only GIT_DIR; all executed source/tests/tools are regular candidate copies. Profile test revision strings are empty outside Git; independent candidate and hashes are authoritative.' };
save('remaining-execution.json', evidence);
rmSync(scratch, { recursive:true, force:true });
save('remaining-cleanup.json', { scratch, removed:!existsSync(scratch), allRecordedGroupsAbsent:runs.every(run=>run.groups.every(group=>!group.alive)&&!run.child.groupAlive), rawSha256:hash(readFileSync(join(scope,'remaining-execution.json'))) });
if (failure) throw new Error(failure.message);

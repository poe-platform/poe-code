import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import ts from 'typescript';
import { save, sha256, runChild, env, owned, root } from './harness.mjs';

const casesPath = 'tests/shell-stress/invocation-modes/cases.ts';
const holdoutPath = 'tests/shell-stress/invocation-modes/holdout.test.ts';
const nativePath = 'tests/shell-stress/invocation-modes/native-corrected-evidence.json';
const prior = JSON.parse(await readFile(resolve(owned, 'legacy-headerless-revision-proof.json')));
const original = execFileSync('git', ['show', `f98696f:${casesPath}`]);
const revised = await readFile(casesPath);
const nativeBytes = await readFile(nativePath);
const holdout = await readFile(holdoutPath, 'utf8');
assert.equal(sha256(original), prior.originalHash);
assert.equal(sha256(revised), prior.proposedHash);
assert.equal(revised.toString(), original.toString().replace(prior.originalLine, prior.proposedLine));
assert.equal(sha256(nativeBytes), '86e6be4ec1ad22f3c5956ed0b37d8091653c4858fbf143f35b2e80eae4b67e45');
const guard = holdout.slice(holdout.indexOf('const nativeBytes ='), holdout.indexOf('assert.equal(native.profiles.length, 2);'));
assert.ok(guard.includes('const originalCohortHash'));
const compiled = ts.transpileModule(guard, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const guardFunction = new AsyncFunction('readFile', 'owned', 'sha256', 'assert', compiled);
const mutants = [];
for (const [id, caseBytes, oracleBytes, expected] of [
  ['pinned-original', original, nativeBytes, true],
  ['pinned-revised', revised, nativeBytes, true],
  ['unrelated-case-id', Buffer.from(revised.toString().replace('path-empty', 'path-empts')), nativeBytes, false],
  ['extra-case-byte', Buffer.concat([revised, Buffer.from(' ')]), nativeBytes, false],
  ['headerless-fixture-byte', Buffer.from(revised.toString().replace('native-fallback', 'native-fallbacK')), nativeBytes, false],
  ['another-policy-status', Buffer.from(revised.toString().replace('policyStatus: 126', 'policyStatus: 0')), nativeBytes, false],
  ['native-cohort-hash', revised, Buffer.from(nativeBytes.toString().replace(prior.originalHash, prior.proposedHash)), false],
  ['native-byte', revised, Buffer.concat([nativeBytes, Buffer.from(' ')]), false],
]) {
  let passed = true; let rejection;
  try { await guardFunction(async path => path.endsWith('/cases.ts') ? caseBytes : oracleBytes, 'memory', sha256, assert); }
  catch (error) { passed = false; rejection = error.message; }
  assert.equal(passed, expected, id);
  mutants.push({ id, expectedAccepted: expected, accepted: passed, rejection, caseHash: sha256(caseBytes), nativeHash: sha256(oracleBytes) });
}
const native = JSON.parse(nativeBytes.toString());
for (const profile of native.profiles) {
  const row = profile.rows.find(row => row.id === 'path-headerless-policy');
  assert.equal(row.result.code, 0); assert.equal(row.result.stdoutHex, '6e61746976652d66616c6c6261636b0a'); assert.equal(row.result.stderrHex, ''); assert.deepEqual(row.effects, {});
  assert.equal(row.renderedFixtures[0].sha256, prior.fixtureHash);
}
const fixed = [];
async function list(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { if (entry.name.startsWith('.')) continue; const path = `${directory}/${entry.name}`; if (entry.isDirectory()) await list(path); else if (/\.(?:[cm]?ts|tsx|mjs|json)$/u.test(path)) fixed.push(path); } }
await list('src'); await list('tests/shell-stress/invocation-modes'); await list('tests/shell-stress/expanded-gaps'); await list('tests/shell-stress/current-shell');
fixed.push('package.json', 'package-lock.json', 'tsconfig.json');
const snapshot = async paths => Object.fromEntries(await Promise.all(paths.map(async path => [path, await readFile(path).then(sha256).catch(() => null)])));
const manifests = {};
const store = values => { const sorted = Object.fromEntries(Object.entries(values).sort()); const hash = sha256(JSON.stringify(sorted)); manifests[hash] = sorted; return hash; };
const temporary = await mkdtemp(resolve(tmpdir(), 'safe-bash-headerless-guard-'));
const records = []; const pids = new Set(); const started = new Date().toISOString();
const sourceStamp = () => ({ head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), runtimeCommit: execFileSync('git', ['log', '-1', '--format=%H', '--', 'src/shell/runtime.ts'], { encoding: 'utf8' }).trim(), dirtySource: execFileSync('git', ['diff', '--name-only', '--', 'src'], { encoding: 'utf8' }) });
const initialStamp = sourceStamp();
try {
  const typeArgs = ['node_modules/typescript/bin/tsc', '--noEmit', '--target', 'ES2023', '--lib', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--noUncheckedIndexedAccess', '--exactOptionalPropertyTypes', '--verbatimModuleSyntax', '--forceConsistentCasingInFileNames', '--skipLibCheck', '--types', 'node', holdoutPath];
  for (const [label, args, compiler] of [
    ['CORRECTED72', ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1', holdoutPath], false],
    ['scoped-types', typeArgs, true],
  ]) {
    const trace = resolve(temporary, label + '.jsonl'); const childEnv = { ...env, GAPS_ACCEPTANCE_TRACE: trace };
    const listed = compiler ? await runChild(process.execPath, [...args, '--listFilesOnly'], { env: childEnv, deadline: 30000 }) : undefined;
    if (listed) { pids.add(listed.pid); assert.equal(listed.status, 0); }
    const compilerPaths = listed ? Buffer.from(listed.stdout, 'base64').toString().split('\n').filter(path => path.startsWith('/') && /\.[cm]?tsx?$/u.test(path)).map(path => relative(root, path)) : [];
    const paths = [...new Set([...fixed, ...compilerPaths])].sort(); const before = await snapshot(paths); const stamp = sourceStamp();
    const run = await runChild(process.execPath, ['--import', resolve(owned, 'acceptance-trace.mjs'), ...args, ...(compiler ? ['--listFiles'] : [])], { env: childEnv, deadline: 60000 }); pids.add(run.pid);
    const after = await snapshot(paths); const loads = (await readFile(trace, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
    for (const entry of loads) pids.add(entry.pid);
    const text = Buffer.from(run.stdout, 'base64').toString();
    const actual = [...new Set(compiler ? text.split('\n').filter(path => path.startsWith('/') && /\.[cm]?tsx?$/u.test(path)).map(path => relative(root, path)) : loads.map(entry => relative(root, entry.path)))].sort();
    const changed = actual.filter(path => !before[path] || before[path] !== after[path]); const drift = paths.filter(path => before[path] !== after[path]);
    const mismatches = loads.filter(entry => before[relative(root, entry.path)] !== entry.hash || after[relative(root, entry.path)] !== entry.hash);
    const counts = Object.fromEntries([...text.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
    const observations = label === 'CORRECTED72' ? text.split('\n').filter(line => line.startsWith('# {"id":')).map(line => { const match = /"stdoutHex":"([a-f0-9]*)"/u.exec(line); assert.ok(match); return JSON.parse(Buffer.from(match[1], 'hex').toString()); }) : [];
    const guarded = actual.length > 0 && !changed.length && !mismatches.length && !drift.length;
    records.push({ label, args, env: childEnv, stamp, run, listed, counts, before: store(before), after: store(after), loaded: store(Object.fromEntries(loads.map(entry => [relative(root, entry.path), entry.hash]))), actual, compilerPaths, changed, drift, mismatches, guarded, observations });
    console.log(JSON.stringify({ label, status: run.status, counts, guarded, changed, drift, actualInputs: actual.length }));
    assert.ok(!run.timedOut && !run.overflow && !run.groupAlive);
  }
  const alive = [];
  for (const pid of pids) for (const target of [pid, -pid]) { try { process.kill(target, 0); alive.push(target); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  const proof = { originalBytesBase64: original.toString('base64'), revisedBytesBase64: revised.toString('base64'), originalHash: sha256(original), revisedHash: sha256(revised), originalLine: prior.originalLine, revisedLine: prior.proposedLine, originalNativeArtifactHash: sha256(nativeBytes), originalNativeCohortHash: native.cohortHash, nativeReferencesReused: true, nativeProfiles: native.profiles.map(profile => ({ id: profile.id, executable: profile.executable, interpreterHash: profile.interpreterHash, row: profile.rows.find(row => row.id === 'path-headerless-policy') })), guardSource: guard, guardSourceHash: sha256(guard), mutants, prior71of72: 'ready-original72.json', previousProof: 'legacy-headerless-revision-proof.json', minimalDiff: execFileSync('git', ['diff', '--', casesPath, holdoutPath], { encoding: 'utf8' }) };
  save('legacy-headerless-migration-evidence.json', { started, finished: new Date().toISOString(), initialStamp, finalStamp: sourceStamp(), proof, manifests, records, checkedPids: pids.size, alive, frozenNativeUnchanged: sha256(await readFile(nativePath)) === sha256(nativeBytes), finalCasesHash: sha256(await readFile(casesPath)), status: records.every(record => record.run.status === 0 && record.guarded) && !alive.length ? 'validated' : 'failures-or-drift-retained' });
} finally { await rm(temporary, { recursive: true, force: true }); }

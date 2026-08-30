import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, realpath, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, relative, dirname } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { runChild, environment } from '../current-shell/support.mjs';
import { nativeCases, hostCases } from '../expanded-gaps/cases.mjs';
import { env } from '../expanded-gaps/harness.mjs';
import { save, sha256, alive } from './support.mjs';
import { save as saveConsumer } from '../errexit-consumer/support.mjs';

const revision = '6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a';
const liveRoot = process.cwd();
const owned = 'tests/shell-stress/kernel-reconciliation';
const publicOwned = 'tests/shell-stress/errexit-consumer';
const started = new Date().toISOString();
const ready = await readFile('/tmp/safe-bash-errexit-author-ready.txt', 'utf8');
assert.ok(ready.includes(revision) && ready.includes('SOURCE WRITE LEASE RELINQUISHED'));
const built = JSON.parse(await readFile(`${publicOwned}/final-built-6e3e316.json`));
assert.equal(built.completed, true);
assert.equal(built.summary.native[0].passed, 10);
assert.equal(built.summary.host.passed, 2);
const prior = JSON.parse(await readFile(`${owned}/acceptance-f1bb98b.json`));
const proof = JSON.parse(await readFile(`${owned}/acceptance-ready-proof.json`));
const prepared = JSON.parse(await readFile(`${publicOwned}/preparation.json`));
const frozen36 = JSON.parse(await readFile('tests/shell-stress/expanded-gaps/native-frozen.json'));
const frozen57 = JSON.parse(await readFile('tests/shell-stress/invocation-modes/native-corrected-evidence.json'));
const frozen10 = JSON.parse(await readFile(`${publicOwned}/native-frozen.json`));
const originalPaths = execFileSync('git', ['ls-tree', '-r', '--name-only', 'a111a2a', '--', publicOwned], { encoding: 'utf8' }).trim().split('\n');
const immutable = { ...proof.immutable, ...prepared.fixedInputs };
for (const path of originalPaths) immutable[path] = sha256(execFileSync('git', ['show', `a111a2a:${path}`]));
for (const [path, hash] of Object.entries(immutable)) {
  assert.equal(sha256(await readFile(path)), hash, `Live frozen input changed: ${path}`);
  assert.equal(sha256(execFileSync('git', ['show', `${revision}:${path}`], { maxBuffer: 16e6 })), hash, `Committed frozen input changed: ${path}`);
}
const allPaths = execFileSync('git', ['ls-tree', '-r', '--name-only', revision], { encoding: 'utf8' }).trim().split('\n');
const selected = new Set(allPaths.filter(path => path.startsWith('src/') || /^(tests|benchmarks)\/.*\.(?:[cm]?ts|tsx|[cm]?js)$/.test(path)));
for (const path of ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'benchmarks/tsconfig.json', 'benchmarks/package.json', ...Object.keys(immutable)]) selected.add(path);
const scratch = await realpath(await mkdtemp(resolve(tmpdir(), 'safe-bash-final-6e-')));
const snapshot = resolve(scratch, 'safe-bash');
await mkdir(snapshot);
const manifests = {};
const store = value => { const sorted = Object.fromEntries(Object.entries(value).sort()); const digest = sha256(JSON.stringify(sorted)); manifests[digest] = sorted; return digest; };
const snapshotFiles = async (root, paths) => Object.fromEntries(await Promise.all(paths.map(async path => [path, await readFile(resolve(root, path)).then(sha256).catch(() => null)])));
const expected = {};
const phases = [];
const compilerPhases = [];
const pids = new Set();
const product36 = [];
const productHost = [];
let observations72 = [];
let comparison57 = [];
const metadata = { revision, readyHash: sha256(ready), snapshot, committedPaths: [...selected].sort(), immutable, liveHeadBefore: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), liveStatusBefore: execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim() };
const tuple57 = row => ({ status: row.exitCode ?? row.result?.code, stdoutHex: row.stdoutHex ?? row.result?.stdoutHex, stderrHex: row.stderrHex ?? row.result?.stderrHex, effects: row.effects });
const guards = async () => {
  const actual = await snapshotFiles(snapshot, Object.keys(expected));
  const drift = Object.keys(expected).filter(path => expected[path] !== actual[path]);
  return { manifest: store(actual), drift };
};
async function phase(id, args, options = {}) {
  const before = await guards();
  assert.deepEqual(before.drift, [], 'Fixed snapshot changed before phase');
  const trace = resolve(scratch, id + '.imports');
  const argv = ['--import', resolve(snapshot, 'tests/shell-stress/expanded-gaps/acceptance-trace.mjs'), ...args];
  const run = await runChild(process.execPath, argv, { cwd: snapshot, env: { ...(options.native ? { ...environment, PATH: process.env.PATH } : options.env ?? environment), GAPS_ACCEPTANCE_TRACE: trace }, deadline: options.deadline ?? 12000 });
  pids.add(run.pid);
  const after = await guards();
  const loads = (await readFile(trace, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const loaded = {};
  const byPid = {};
  const mismatch = [];
  for (const load of loads) {
    const path = relative(snapshot, load.path);
    loaded[path] = load.hash;
    (byPid[load.pid] ??= {})[path] = load.hash;
    pids.add(load.pid);
    if (expected[path] !== load.hash) mismatch.push({ ...load, relative: path });
  }
  const valid = !run.timedOut && !run.overflow && !run.groupAlive && !before.drift.length && !after.drift.length && !mismatch.length && (options.native || !!loaded['src/shell/runtime.ts']);
  const record = { id, argv: [process.execPath, ...argv], cwd: snapshot, run, before: before.manifest, after: after.manifest, loaded: store(loaded), byPid: Object.fromEntries(Object.entries(byPid).map(([pid, files]) => [pid, store(files)])), drift: after.drift, mismatch, valid };
  phases.push(record);
  console.log(`${id}: exit=${run.status} guard=${valid} imports=${Object.keys(loaded).filter(path => path.startsWith('src/')).length}`);
  assert.equal(valid, true, 'Preserve invalid evidence; no automatic retry');
  return record;
}
async function compilerPhase(id, root, config) {
  const sourceBefore = root === snapshot ? await guards() : null;
  const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: liveRoot, encoding: 'utf8' }).trim();
  const args = [resolve(liveRoot, 'node_modules/typescript/bin/tsc'), '-p', resolve(root, config), '--noEmit'];
  const enumeration = await runChild(process.execPath, [...args, '--listFilesOnly'], { cwd: root, env: environment, deadline: 60000 });
  pids.add(enumeration.pid);
  const list = run => Buffer.from(run.stdout, 'base64').toString().split('\n').filter(path => path.startsWith('/') && /\.[cm]?tsx?$/.test(path));
  const listed = list(enumeration);
  const configPaths = ['tsconfig.json', 'tsconfig.build.json', 'benchmarks/tsconfig.json', 'package.json'].map(path => resolve(root, path));
  const inputs = [...new Set([...listed, ...configPaths, resolve(liveRoot, 'node_modules/typescript/lib/_tsc.js')])];
  const before = await snapshotFiles('/', inputs);
  const run = await runChild(process.execPath, [...args, '--listFiles'], { cwd: root, env: environment, deadline: 90000 });
  pids.add(run.pid);
  const actual = list(run);
  const after = await snapshotFiles('/', [...new Set([...inputs, ...actual])]);
  const drift = inputs.filter(path => before[path] !== after[path]);
  const unlisted = actual.filter(path => !listed.includes(path));
  const sourceAliases = root === snapshot ? actual.filter(path => path.startsWith(resolve(liveRoot, 'src') + '/')) : [];
  const sourceAfter = root === snapshot ? await guards() : null;
  const diagnostics = Buffer.from(run.stdout, 'base64').toString().split('\n').filter(line => line && !actual.includes(line));
  const valid = enumeration.status === 0 && !enumeration.timedOut && !enumeration.overflow && !run.timedOut && !run.overflow && !run.groupAlive && !drift.length && !unlisted.length && !sourceAliases.length && !(sourceAfter?.drift.length);
  compilerPhases.push({ id, root, argv: [process.execPath, ...args, '--listFiles'], headBefore, headAfter: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: liveRoot, encoding: 'utf8' }).trim(), enumeration, run, before: store(before), after: store(after), listedCount: listed.length, actualCount: actual.length, drift, unlisted, sourceAliases, diagnostics, sourceBefore, sourceAfter, valid });
  console.log(JSON.stringify({ id, status: run.status, count: actual.length, diagnostics, drift, unlisted, sourceAliases, valid }));
}
try {
  const paths = [...selected].sort();
  assert.ok(paths.join('\n').length < 180000, 'Bounded git archive argv');
  const archive = execFileSync('/usr/bin/git', ['archive', '--format=tar', revision, ...paths], { maxBuffer: 128e6 });
  metadata.archiveHash = sha256(archive);
  const unpack = await runChild('/usr/bin/tar', ['-xf', '-', '-C', snapshot], { env: environment, stdin: archive, deadline: 20000 });
  pids.add(unpack.pid);
  metadata.unpack = unpack;
  assert.equal(unpack.status, 0);
  const batch = execFileSync('/usr/bin/git', ['cat-file', '--batch'], { input: paths.map(path => `${revision}:${path}`).join('\n') + '\n', maxBuffer: 128e6 });
  let cursor = 0;
  for (const path of paths) {
    const newline = batch.indexOf(10, cursor);
    const size = Number(batch.subarray(cursor, newline).toString().split(' ')[2]);
    assert.ok(Number.isFinite(size));
    expected[path] = sha256(batch.subarray(newline + 1, newline + 1 + size));
    cursor = newline + 1 + size + 1;
  }
  assert.deepEqual((await guards()).drift, []);
  assert.equal(expected['src/shell/runtime.ts'], '5589f60a1db983538d37168e3b9276555ef71a2bc67446783535e47789f9d6eb');
  assert.equal(expected['src/shell/parser.ts'], '10d015eb62fd4e4f964666c04e5869ea78afdb76d930181760adecbcf16ab65e');
  assert.equal(expected['package.json'], '1f9579a9be0c1e1f23f03f38babad319fc1f8af941c7755aa7ca8759584cc2f1');
  metadata.additiveHelpers = {};
  for (const path of [`${owned}/final-native36.mjs`, `${owned}/final-native57.ts`, `${publicOwned}/final-native.mjs`]) {
    const bytes = await readFile(path);
    expected[path] = sha256(bytes);
    metadata.additiveHelpers[path] = expected[path];
    await mkdir(dirname(resolve(snapshot, path)), { recursive: true });
    await writeFile(resolve(snapshot, path), bytes);
  }
  metadata.tooling = { rootModules: await realpath('node_modules'), benchmarkModules: await realpath('benchmarks/node_modules'), compilerHash: sha256(await readFile('node_modules/typescript/lib/_tsc.js')), node: process.version };
  await symlink(metadata.tooling.rootModules, resolve(snapshot, 'node_modules'));
  await symlink(metadata.tooling.benchmarkModules, resolve(snapshot, 'benchmarks/node_modules'));
  metadata.expectedManifest = store(expected);
  await phase('native10', ['--import', 'tsx', `${publicOwned}/final-native.mjs`], { native: true, deadline: 60000 });
  await phase('native36', ['--import', 'tsx', `${owned}/final-native36.mjs`], { native: true, deadline: 120000 });
  await phase('native57', ['--import', 'tsx', `${owned}/final-native57.ts`], { native: true, deadline: 120000 });
  const fresh10 = JSON.parse(await readFile(resolve(snapshot, `${publicOwned}/final-native-6e3e316.json`)));
  const fresh36 = JSON.parse(await readFile(resolve(snapshot, `${owned}/final-native36-6e3e316.json`)));
  const fresh57 = JSON.parse(await readFile(resolve(snapshot, `${owned}/final-native57-6e3e316.json`)));
  saveConsumer('final-native-6e3e316.json', fresh10);
  save('final-native36-6e3e316.json', fresh36);
  save('final-native57-6e3e316.json', fresh57);
  metadata.nativeDrift10 = fresh10.profiles.map(profile => ({ role: profile.role, total: profile.rows.length, changed: profile.rows.filter(row => !isDeepStrictEqual(row.tuple, frozen10.profiles.find(old => old.role === profile.role).rows.find(old => old.id === row.id).tuple)).map(row => row.id) }));
  metadata.nativeDrift36 = fresh36.profiles.map(profile => ({ role: profile.role, total: profile.rows.length, changed: profile.rows.filter(row => !isDeepStrictEqual(row.tuple, frozen36.profiles.find(old => old.role === profile.role).rows.find(old => old.id === row.id).tuple)).map(row => row.id) }));
  metadata.nativeDrift57 = fresh57.profiles.map(profile => ({ role: profile.id, total: profile.rows.length, changed: profile.rows.filter(row => !isDeepStrictEqual(tuple57(row), tuple57(frozen57.profiles.find(old => old.id === profile.id).rows.find(old => old.id === row.id)))).map(row => row.id) }));
  for (const fresh of [fresh10, fresh36]) for (const profile of fresh.profiles) { pids.add(profile.version.pid); for (const row of [...profile.rows, ...profile.controls]) pids.add(row.run.pid); }
  for (const profile of fresh57.profiles) { pids.add(profile.version.pid); for (const row of profile.rows) pids.add(row.result.pid); }
  for (const fixture of [...nativeCases, ...hostCases]) {
    const record = await phase(fixture.id, ['--import', 'tsx', 'tests/shell-stress/expanded-gaps/product.mjs', fixture.id], { env });
    let protocol;
    try { protocol = JSON.parse(Buffer.from(record.run.stdout, 'base64').toString()); } catch { protocol = { protocolError: true }; }
    const row = { id: fixture.id, actual: protocol.observation, protocol, valid: record.valid && record.run.status === 0 };
    if (fixture.kind) productHost.push({ ...row, passed: row.actual?.passed === true });
    else product36.push({ ...row, profiles: frozen36.profiles.map(profile => ({ role: profile.role, passed: isDeepStrictEqual(row.actual, profile.rows.find(old => old.id === fixture.id).tuple) })) });
    const previous = fixture.kind ? prior.productHost.find(old => old.id === fixture.id) : prior.product36.find(old => old.id === fixture.id);
    if (fixture.kind ? !row.actual?.passed : previous.profiles[0].passed && !isDeepStrictEqual(row.actual, previous.actual)) throw new Error(`Previously accepted case changed: ${fixture.id}; route ROOT, no retry`);
  }
  const holdout = await phase('corrected72', ['--unhandled-rejections=strict', '--import', 'tsx', '--test', '--test-concurrency=1', 'tests/shell-stress/invocation-modes/holdout.test.ts'], { deadline: 120000 });
  const tap = Buffer.from(holdout.run.stdout, 'base64').toString();
  save('final-corrected72.tap', tap);
  for (const line of tap.split('\n')) if (line.startsWith('# {"id":')) {
    const hex = line.match(/"stdoutHex":"([a-f0-9]*)"/u)?.[1];
    assert.notEqual(hex, undefined);
    observations72.push(JSON.parse(Buffer.from(hex, 'hex').toString()));
    const pid = line.match(/"pid":(\d+)/u)?.[1]; if (pid) pids.add(Number(pid));
  }
  assert.equal(observations72.length, 72);
  comparison57 = frozen57.profiles[0].rows.map(fixture => ({ id: fixture.id, actual: tuple57(observations72.find(row => row.id === fixture.id)), profiles: frozen57.profiles.map(profile => ({ role: profile.id, expected: tuple57(profile.rows.find(row => row.id === fixture.id)), passed: isDeepStrictEqual(tuple57(observations72.find(row => row.id === fixture.id)), tuple57(profile.rows.find(row => row.id === fixture.id))) })) }));
  metadata.summary = { product36: frozen36.profiles.map(profile => ({ role: profile.role, total: 36, passed: product36.filter(row => row.profiles.find(item => item.role === profile.role).passed).length })), host10: { passed: productHost.filter(row => row.passed).length, total: productHost.length }, corrected72: Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(name => [name, Number(tap.match(new RegExp(`^# ${name} (\\d+)$`, 'm'))?.[1])])), raw57: frozen57.profiles.map(profile => ({ role: profile.id, total: 57, passed: comparison57.filter(row => row.profiles.find(item => item.role === profile.id).passed).length })) };
  console.log(JSON.stringify(metadata.summary));
  assert.equal(holdout.run.status, 0, 'Unchanged corrected72 failed; report before further runs');
  for (const [id, config] of [['frozen-global', 'tsconfig.json'], ['frozen-build', 'tsconfig.build.json'], ['frozen-benchmark', 'benchmarks/tsconfig.json']]) await compilerPhase(id, snapshot, config);
  await compilerPhase('live-global-qualified', liveRoot, 'tsconfig.json');
} catch (error) {
  metadata.failure = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  metadata.endpoint = Object.keys(expected).length ? await guards() : null;
  metadata.liveHeadAfter = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  metadata.liveStatusAfter = execFileSync('git', ['status', '--short'], { encoding: 'utf8' }).trim();
  metadata.immutableDrift = [];
  for (const [path, hash] of Object.entries(immutable)) if (sha256(await readFile(path)) !== hash) metadata.immutableDrift.push(path);
  await rm(scratch, { recursive: true, force: true });
  metadata.cleaned = true;
  const children = [...pids].filter(Boolean).map(pid => ({ pid, groupAlive: alive(pid) }));
  save('final-snapshot-6e3e316.json', { started, finished: new Date().toISOString(), metadata, manifests, phases, product36, productHost, observations72, comparison57, compilerPhases, children });
  console.log(JSON.stringify({ failure: metadata.failure, summary: metadata.summary, guards: phases.filter(row => row.valid).length, phases: phases.length, alive: children.filter(row => row.groupAlive) }));
}

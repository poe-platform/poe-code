import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const output = path.dirname(fileURLToPath(import.meta.url));
const runRoot = path.join(output, 'representative-v3-attempt-001');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = name => fs.readFileSync(path.join(output, name));
const json = name => JSON.parse(read(name));
const runJson = name => JSON.parse(fs.readFileSync(path.join(runRoot, name)));
const jsonl = name => fs.readFileSync(path.join(runRoot, name), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const plan = json('representative-plan-v3.json');
const closure = json('execution-closure.json');
const published = json('published-files.json');
const setup = json('setup-review.json');
const approval = JSON.parse(fs.readFileSync('/tmp/safe-bash-baseline-auth-approval-v3.json'));
const download = json('download.json');
const summary = runJson('summary.json'), supervisor = runJson('supervisor-summary.json');
assert.deepEqual(summary.failures, []); assert.deepEqual(supervisor.failures, []);
assert.equal(supervisor.complete, true); assert.equal(supervisor.groupConfirmedGone, true);
assert.equal(supervisor.coordinatorExit.code, 0); assert.equal(supervisor.coordinatorExit.signal, null);
assert.equal(supervisor.coordinatorPipesClosed, true); assert.equal(summary.activeChildren, 0);
assert.equal(summary.globalExpired, false);
for (const [name, sha256] of Object.entries(approval.files)) assert.equal(digest(read(name)), sha256, `approved input ${name}`);
assert.equal(digest(fs.readFileSync('/tmp/safe-bash-baseline-auth-plan.txt')), approval.textPlanSha256);
assert.equal(digest(fs.readFileSync(download.executable)), download.nodeSha256);

const expected = new Map([...closure.files, ...plan.closureAdditions].map(entry => [entry.path, entry]));
assert.equal(expected.size, 3844);
const directories = new Set();
for (const relative of expected.keys()) {
  let parent = path.posix.dirname(relative);
  while (parent !== '.') { directories.add(parent); parent = path.posix.dirname(parent); }
}
const actualFiles = [];
const pending = [''];
while (pending.length) {
  const relative = pending.pop();
  for (const name of fs.readdirSync(path.join(closure.root, relative)).sort()) {
    const member = relative ? `${relative}/${name}` : name;
    const absolute = path.join(closure.root, member), stat = fs.lstatSync(absolute);
    assert.equal(stat.isSymbolicLink(), false, member);
    if (stat.isDirectory()) { assert.ok(directories.has(member), `unexpected directory ${member}`); pending.push(member); continue; }
    assert.ok(stat.isFile() && stat.nlink === 1, `not independent regular file ${member}`);
    const sealed = expected.get(member); assert.ok(sealed, `unexpected file ${member}`);
    const bytes = fs.readFileSync(absolute), sha256 = digest(bytes), mode = stat.mode & 0o777;
    assert.equal(sha256, sealed.sha256, member); assert.equal(bytes.length, sealed.bytes, member); assert.equal(mode, sealed.mode, member);
    actualFiles.push({ path: member, bytes: bytes.length, sha256, mode, nlink: stat.nlink });
  }
}
actualFiles.sort((left, right) => left.path.localeCompare(right.path));
assert.deepEqual(actualFiles.map(entry => entry.path).sort(), [...expected.keys()].sort());
const actualByPath = new Map(actualFiles.map(entry => [entry.path, entry]));
const packagePrefix = 'benchmarks/node_modules/just-bash/';
const actualPackage = actualFiles.filter(entry => entry.path.startsWith(packagePrefix));
assert.deepEqual(actualPackage.map(entry => entry.path.slice(packagePrefix.length)).sort(), published.files.map(entry => entry.path).sort());
for (const entry of published.files) {
  const actual = actualByPath.get(packagePrefix + entry.path);
  assert.equal(actual.sha256, entry.sha256, `published package ${entry.path}`); assert.equal(actual.bytes, entry.bytes, entry.path);
}
assert.equal(actualPackage.length, 955);
const manifest = JSON.parse(fs.readFileSync(path.join(closure.root, packagePrefix, 'package.json')));
assert.equal(manifest.name, 'just-bash'); assert.equal(manifest.version, '3.4.2');

const events = jsonl('events.jsonl'), supervisorEvents = jsonl('supervisor-events.jsonl');
const count = name => events.filter(event => event.event === name).length;
for (const name of ['child-launch-attempt', 'child-launched', 'ready-received', 'request-dispatch-intent', 'request-send-called', 'request-send-returned', 'request-send-callback', 'request-settlement', 'response-received', 'ipc-disconnect-request', 'ipc-disconnected', 'child-exit', 'child-cleanup-settlement']) assert.equal(count(name), 8, name);
for (const name of ['cleanup-signal', 'child-error', 'child-process-error', 'request-send-threw', 'late-message-ignored', 'coordinator-deadline', 'coordinator-sigterm']) assert.equal(count(name), 0, name);
assert.equal(supervisorEvents.filter(event => event.event === 'coordinator-launched').length, 1);
assert.equal(supervisorEvents.filter(event => event.event === 'owned-group-signal').length, 0);
assert.equal(events.filter(event => event.event === 'request-send-callback' && !event.success).length, 0);
assert.equal(events.filter(event => event.event === 'request-settlement' && event.kind !== 'response').length, 0);
const active = new Set(); let maximumActiveEngines = 0;
for (const event of events) {
  if (event.event === 'child-launched') { assert.equal(active.has(event.pid), false); active.add(event.pid); maximumActiveEngines = Math.max(maximumActiveEngines, active.size); }
  if (event.event === 'child-exit') { assert.ok(active.delete(event.pid)); assert.equal(event.code, 0); assert.equal(event.signal, null); }
}
assert.equal(active.size, 0); assert.equal(maximumActiveEngines, 1);
const fields = ['stdout', 'stderr', 'exitCode', 'entries'];
const compare = (expectedValue, observed) => {
  const assertions = fields.map(field => ({ field, pass: JSON.stringify(expectedValue[field]) === JSON.stringify(observed[field]) }));
  return { pass: assertions.every(assertion => assertion.pass), assertions };
};
const entryRelative = packagePrefix + 'dist/bundle/index.js';
const entryAbsolute = path.join(closure.root, entryRelative);
const sourceProfiles = [];
for (const profile of [...new Set(plan.rows.map(row => row.profile))]) {
  const relative = `profiles/${profile}/benchmarks/expanded/engine.mjs`;
  const bytes = fs.readFileSync(path.join(closure.root, relative)), source = bytes.toString(), lines = source.split('\n');
  const priorReview = setup.profiles.find(entry => entry.profile === profile);
  assert.equal(digest(bytes), priorReview.engineSha256);
  assert.equal(source.includes('customCommands'), false);
  assert.ok(source.includes('return definition.execute(...args);'));
  const line = text => { const index = lines.findIndex(value => value.includes(text)); assert.ok(index >= 0, text); return index + 1; };
  sourceProfiles.push({ profile, path: relative, sha256: digest(bytes), equalsPreviouslyReviewedFrozenEngine: true, lines: { awaitedEntryImport: line('library = await import(pathToFileURL(join(baselineRoot'), ready: line('process.send?.({ ready: true })'), constructor: line('shell = new library.Bash'), sameNameForwardWrapper: line('if (instrument) for (const [name, definition] of shell.commands)'), originalExecuteForward: line('registryEvents.push({ name, args: [...args[0]] }); return definition.execute(...args);'), warmupLoop: line('count < warmup'), messageHandler: line('process.on("message"') }, customCommandsSupplied: false, wrapper: 'same existing command name; shallow original definition plus recording wrapper returning original definition.execute(...args)', branch: 'EXPANDED_ENGINE=just-bash; the virtual-bash empty-script initialization branch is not selected' });
}
const outcomes = [], loadProof = [];
for (const selection of plan.rows) {
  const result = runJson(`result-${selection.sequence}.json`), observed = result.response.observation;
  assert.equal(result.response.id, selection.sequence); assert.equal(result.profile, selection.profile); assert.equal(result.recipeId, selection.id);
  assert.deepEqual(result.errors, []); assert.equal(result.lifecycle.normal, true);
  const old = compare(selection.oldBaselineFourFields, observed), native = compare(selection.expectedNative, observed);
  assert.equal(old.pass, true); assert.deepEqual(old, result.comparisons.oldBaseline); assert.deepEqual(native, result.comparisons.native);
  assert.deepEqual(native.assertions.filter(entry => !entry.pass).map(entry => entry.field), selection.oldFailedFields);
  const history = events.filter(event => event.sequence === selection.sequence);
  const sent = history.find(event => event.event === 'request-send-called');
  assert.equal(sent.warmup, 0); assert.equal(sent.instrument, true); assert.equal(sent.recipeSha256, selection.recipeSha256);
  const rawResponse = history.find(event => event.event === 'response-received').response;
  assert.deepEqual(rawResponse, result.response);
  const traceName = `imports-${selection.sequence}.jsonl`, trace = jsonl(traceName);
  assert.equal(digest(fs.readFileSync(path.join(runRoot, traceName))), result.trace.sha256);
  assert.equal(trace.filter(event => event.event === 'forbidden-extra-process-attempt' || event.event === 'load-error').length, 0);
  const start = trace.find(event => event.event === 'process-start');
  assert.equal(start.pid, result.pid); assert.equal(start.cwd, closure.root); assert.equal(start.argv[0], download.executable);
  assert.equal(start.argv[1], path.join(closure.root, `profiles/${selection.profile}/benchmarks/expanded/engine.mjs`));
  assert.deepEqual(start.execArgv, ['--expose-gc', '--unhandled-rejections=strict', '--import', 'tsx', '--max-old-space-size=256']);
  assert.equal(trace.filter(event => event.event === 'ipc-disconnect').length, 1);
  assert.equal(trace.filter(event => event.event === 'process-exit' && event.code === 0).length, 1);
  const attempts = trace.filter(event => event.event === 'load-attempt');
  for (const event of attempts) {
    const relative = path.relative(closure.root, event.filename);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    assert.equal(event.sha256, actualByPath.get(relative)?.sha256, `runtime loaded bytes ${relative}`);
  }
  const resolutions = trace.filter(event => event.event === 'resolve-returned');
  for (const event of resolutions) if (!event.url.startsWith('node:')) assert.ok(fileURLToPath(event.url).startsWith(closure.root + '/'), event.url);
  const entryResolution = resolutions.find(event => event.url.startsWith('file:') && fileURLToPath(event.url) === entryAbsolute);
  const entryAttempt = attempts.find(event => event.filename === entryAbsolute);
  const entryReturned = trace.find(event => event.event === 'load-returned' && fileURLToPath(event.url) === entryAbsolute);
  assert.ok(entryResolution && entryAttempt && entryReturned);
  assert.equal(entryAttempt.sha256, actualByPath.get(entryRelative).sha256);
  const ready = history.find(event => event.event === 'ready-received'); assert.equal(ready.entryImportFulfilledByEngineProtocol, true);
  assert.ok(Date.parse(ready.at) >= Date.parse(entryReturned.at));
  outcomes.push({ sequence: selection.sequence, profile: selection.profile, id: selection.id, pid: result.pid, recipeSha256: selection.recipeSha256, oldFourFieldsMatch: old.pass, nativePass: native.pass, nativeFailedFields: selection.oldFailedFields, nativeAssertions: native.assertions, lifecycleNormal: result.lifecycle.normal, registryEvents: observed.registryEvents, rawResult: `representative-v3-attempt-001/result-${selection.sequence}.json`, rawResultSha256: digest(fs.readFileSync(path.join(runRoot, `result-${selection.sequence}.json`))), stdoutSha256: digest(Buffer.from(observed.stdout, 'base64')), stderrSha256: digest(Buffer.from(observed.stderr, 'base64')), entriesJsonSha256: digest(JSON.stringify(observed.entries)) });
  loadProof.push({ sequence: selection.sequence, pid: result.pid, importLog: traceName, importLogSha256: result.trace.sha256, processStart: start, entryResolution, entryAttempt, entryReturned, ready, observedFileLoadAttempts: attempts.length, loadedPublishedPaths: [...new Set(attempts.map(event => path.relative(closure.root, event.filename)).filter(relative => relative.startsWith(packagePrefix)))].sort(), allObservedFileLoadHashesMatchPostRunClosure: true, nonClosureResolutions: 0, forbiddenExtraProcessAttempts: 0, limitation: 'Loader returned does not alone prove evaluation; exact engine ready-after-awaited-import supplies bounded entry success. No universal module/thread/worker/native-addon/syscall or asset-read trace.' });
}
const network = runJson('network-requests.json');
assert.deepEqual(network, [{ method: 'GET', path: '/bytes', bytes: '', authorization: null }, { method: 'GET', path: '/bytes', bytes: '', authorization: null }]);
const opened = events.find(event => event.event === 'loopback-open');
assert.equal(new URL(opened.baseUrl).hostname, '127.0.0.1');
assert.equal(count('loopback-closed'), 1);
assert.deepEqual(supervisor.coordinatorCounts, summary.counts); assert.deepEqual(supervisor.retainedJournalCounts, summary.counts);
const rawFiles = fs.readdirSync(runRoot).sort().map(name => { const absolute = path.join(runRoot, name), stat = fs.lstatSync(absolute); assert.ok(stat.isFile() && !stat.isSymbolicLink()); const bytes = fs.readFileSync(absolute); return { path: `representative-v3-attempt-001/${name}`, bytes: bytes.length, sha256: digest(bytes) }; });
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), disposition: 'AUTHOR POST-RUN CHECK PASS; independent final review pending', scope: 'Fresh builtin-only file reads/hashes and retained-event/observation checks. No approved driver/helper import, package execution, network request or process control.', inputHashes: Object.fromEntries(['representative-plan-v3.json', 'execution-closure.json', 'published-files.json', 'setup-review.json', 'download.json', 'driver-fix-manifest.json'].map(name => [name, digest(read(name))])), approvalSha256: digest(fs.readFileSync('/tmp/safe-bash-baseline-auth-approval-v3.json')), integrity: { root: closure.root, baseFiles: 3842, declaredObserverAdditions: 2, actualFiles: actualFiles.length, missingExtraChangedFiles: 0, allIndependentRegularFiles: true, packageFiles: actualPackage.length, packageBytes: actualPackage.reduce((total, entry) => total + entry.bytes, 0), publishedPackageByteAndMembershipEquality: true, packageManifestSha256: actualByPath.get(packagePrefix + 'package.json').sha256, entrySha256: actualByPath.get(entryRelative).sha256, nonPackageBaseFiles: 2887, dependencyLimit: 'Non-package files rehash equal the frozen closure; dependencies are not individually publication-authenticated by this package tarball.' }, actualFiles, sourceProfiles, outcomes, loadProof, lifecycle: { counts: summary.counts, maximumSimultaneousEngines: maximumActiveEngines, managedMaximumConcurrency: 3, enginePids: outcomes.map(row => row.pid), coordinatorPid: supervisor.groupId, supervisorPid: Number(supervisorEvents.find(event => event.event === 'coordinator-launch-attempt').environment.AUTH_SUPERVISOR_PID), supervisorInvocations: 1, spawnedCoordinators: supervisor.spawnedCoordinators, groupConfirmedGoneBySupervisor: supervisor.groupConfirmedGone, coordinatorPipesClosed: supervisor.coordinatorPipesClosed, exceptionalSignals: 0, noTimeoutsOrLateMessages: true, routineIpcDisconnects: 8, limitation: 'Ledger plus supervisor owned-process-group probe, not a universal process/thread/socket census. No extra post-run ps/kill/network control executed.' }, network: { origin: opened.baseUrl, requests: network, closeRecorded: true, perRequestTimestampOrChildAttribution: 'Server records have no PID/time; attribution to the two network recipes is by sequential approved execution and curl registry events, not separate server connection telemetry.' }, summary: { oldObservationMatches: 8, nativePasses: outcomes.filter(row => row.nativePass).length, nativeFailures: outcomes.filter(row => !row.nativePass).length, newBenchmarkDenominator: false, retainedPerformanceFields: 'Unchanged frozen engine includes executeMs/memory sampling in raw responses; no trials, aggregation, new performance experiment or speed/memory claim.' }, rawFiles }, null, 2));

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const own = path.dirname(fileURLToPath(import.meta.url));
const auth = path.dirname(own);
const repo = path.resolve(own, '../../../../..');
const prior = path.join(repo, 'benchmarks/reports/current-integration/comparison-replay-20260827');
const run = path.join(auth, 'representative-v3-attempt-001');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inputs = new Map();
const report = { schema: 1, kind: 'INDEPENDENT_FINAL_OFFLINE_AUTHENTICATION_REVIEW', startedAt: new Date().toISOString(), productCalls: 0, helperExecutions: 0, networkRequests: 0, blockers: [] };
function bytes(filename) {
  const stat = fs.lstatSync(filename);
  const maximum = filename === '/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node' ? 256 * 1024 * 1024 : 64 * 1024 * 1024;
  assert.ok(stat.isFile() && stat.nlink === 1 && stat.size < maximum, filename);
  const content = fs.readFileSync(filename);
  const entry = { sha256: hash(content), bytes: content.length, mode: stat.mode & 0o777 };
  if (inputs.has(filename)) assert.deepEqual(entry, inputs.get(filename), `changed during review: ${filename}`);
  inputs.set(filename, entry);
  return content;
}
const json = filename => JSON.parse(bytes(filename));
const local = filename => json(path.join(auth, filename));
function lines(filename) {
  const text = bytes(filename).toString('utf8');
  assert.ok(text.endsWith('\n') && !text.includes('\n\n'), `incomplete journal: ${filename}`);
  return text.slice(0, -1).split('\n').map(line => JSON.parse(line));
}
function tree(root) {
  const files = {};
  function walk(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const filename = path.join(directory, item.name);
      assert.ok(!item.isSymbolicLink(), filename);
      if (item.isDirectory()) walk(filename);
      else { bytes(filename); files[path.relative(root, filename)] = inputs.get(filename); }
    }
  }
  walk(root);
  return files;
}
const histogram = rows => rows.reduce((counts, row) => ({ ...counts, [row.event]: (counts[row.event] ?? 0) + 1 }), {});
const only = (rows, event) => { const selected = rows.filter(row => row.event === event); assert.equal(selected.length, 1, event); return selected[0]; };
const fields = ['stdout', 'stderr', 'exitCode', 'entries'];
const four = observation => Object.fromEntries(fields.map(field => [field, observation[field]]));
function compare(observation, expected) {
  for (const field of ['stdout', 'stderr']) for (const value of [observation[field], expected[field]]) assert.equal(Buffer.from(value, 'base64').toString('base64'), value);
  const assertions = fields.map(field => ({ field, pass: JSON.stringify(observation[field]) === JSON.stringify(expected[field]) }));
  return { pass: assertions.every(entry => entry.pass), assertions };
}
try {
  const approvalFile = '/tmp/safe-bash-baseline-auth-approval-v3.json';
  const approval = json(approvalFile);
  const approvalSha256 = hash(bytes(approvalFile));
  assert.equal(approvalSha256, '40d096afcb54a38a3fab58ea16ba550350917ce81f80765c07a7c9068b7f0938');
  assert.equal(approval.approved, true);
  assert.equal(approval.authority, 'root');
  assert.equal(Object.keys(approval.files).length, 10);
  for (const [name, expected] of Object.entries(approval.files)) assert.equal(hash(bytes(path.join(auth, name))), expected, name);
  assert.equal(hash(bytes('/tmp/safe-bash-baseline-auth-plan.txt')), approval.textPlanSha256);
  assert.equal(hash(bytes('/tmp/safe-bash-baseline-auth-replay-detail.txt')), 'ae2717ddb52f00a1394077f55689e6b1aab515728346b8fa1101567299dd5d3f');
  assert.equal(local('approval-template-v3.json').approved, false);
  const seals = {};
  for (const [name, expected, count] of [
    ['execution-v3-manifest.json', '3ecfab42e25f93a7f570d5275cc7f74261ed03783e62f717f999ad2e4ec8ac36', 32],
    ['driver-fix-manifest.json', '3fbc048049654a3bc2698fe09365bd91879af06f4a3f5f8e5485dd08a0c40888', 18],
    ['handoff-manifest.json', '17776da9868967eddcce038984ef5dcf5a8418f0901045d97ccba33d6d4dfc65', 29],
  ]) {
    assert.equal(hash(bytes(path.join(auth, name))), expected);
    const manifest = local(name);
    assert.equal(manifest.files.length, count);
    for (const entry of manifest.files) {
      const filename = name === 'handoff-manifest.json' && entry.path === 'representative.mjs' ? 'prior-candidate-v2/representative.mjs' : entry.path;
      const content = bytes(path.join(auth, filename));
      assert.equal(hash(content), entry.sha256, `${name}: ${filename}`);
      assert.equal(content.length, entry.bytes);
    }
    seals[name] = { sha256: expected, files: count };
  }
  const preserved = local('prior-candidate-v2/preservation.json');
  assert.equal(preserved.entries.length, 9);
  for (const entry of preserved.entries) assert.equal(hash(bytes(path.join(auth, entry.priorCopy))), entry.sha256);
  assert.equal(hash(bytes(path.join(own, 'PREFLIGHT.md'))), preserved.entries.find(entry => entry.priorCopy.endsWith('/PREFLIGHT.md')).sha256);
  const plan = local('representative-plan-v3.json');
  assert.deepEqual(plan.rows, local('representative-plan-v2.json').rows);
  assert.deepEqual(plan.rows.map(row => row.sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(new Set(plan.rows.map(row => row.id)).size, 7);
  assert.deepEqual([plan.budget.resultBearingBashExecCalls, plan.budget.freshEngineChildren, plan.budget.coordinatorProcesses, plan.budget.supervisorProcesses], [8, 8, 1, 1]);
  for (const key of ['warmups', 'neutralityCalls', 'transportControls', 'inventoryConstructions', 'oursInitializationCalls', 'retries']) assert.equal(plan.budget[key], 0);
  const published = local('verification/package-final-attempt-1.json');
  assert.equal(published.status, 'PUBLISHED_BYTES_MATCH_FROZEN_PACKAGE_EXECUTION_REVIEW_PENDING');
  const closure = local('execution-closure.json');
  const frozen = json(path.join(prior, 'frozen-files.json'));
  const source = json(path.join(prior, 'source-manifest.json'));
  assert.equal(source.sourceTreeSha256, '76deb591783ac168ca5daef04c4351d7e80b159c003cd27d3a445190ca6fd74c');
  assert.equal(closure.files.length, 3842);
  assert.equal(plan.closureAdditions.length, 2);
  const expectedFiles = [...closure.files, ...plan.closureAdditions];
  assert.equal(new Set(expectedFiles.map(entry => entry.path)).size, 3844);
  const actualFiles = tree(closure.root);
  assert.deepEqual(Object.keys(actualFiles).sort(), expectedFiles.map(entry => entry.path).sort());
  let packageFiles = 0, packageBytes = 0, totalBytes = 0;
  for (const entry of expectedFiles) {
    assert.deepEqual(actualFiles[entry.path], { sha256: entry.sha256, bytes: entry.bytes, mode: entry.mode }, entry.path);
    totalBytes += entry.bytes;
    if (entry.path.startsWith('benchmarks/node_modules/just-bash/')) {
      const member = entry.path.slice('benchmarks/node_modules/just-bash/'.length);
      assert.equal(entry.sha256, published.package.published[member].sha256);
      packageFiles++; packageBytes += entry.bytes;
    } else if (!entry.path.startsWith('auth-observer/')) assert.equal(entry.sha256, frozen[entry.path].sha256);
    else assert.equal(entry.sha256, approval.files[entry.source]);
  }
  assert.equal(packageFiles, 955);
  assert.equal(packageBytes, 22583023);
  assert.equal(totalBytes, closure.totalBytes + 2540);
  assert.deepEqual(local('representative-v3-attempt-001/integrity-before.json'), { files: 3842, exactMembership: true, observerAdditions: [] });
  const stagedIntegrity = { files: 3844, exactMembership: true, observerAdditions: plan.closureAdditions };
  assert.deepEqual(local('representative-v3-attempt-001/integrity-staged.json'), stagedIntegrity);
  assert.deepEqual(local('representative-v3-attempt-001/integrity-after.json'), stagedIntegrity);
  const post = local('execution-post-run-check-attempt-1.json');
  for (const entry of post.actualFiles) assert.deepEqual(actualFiles[entry.path], { sha256: entry.sha256, bytes: entry.bytes, mode: entry.mode });
  assert.equal(post.actualFiles.length, 3844);
  const download = local('download.json');
  assert.equal(fs.realpathSync(download.executable), download.executable);
  assert.equal(hash(bytes(download.executable)), download.nodeSha256);
  const launch = local('representative-v3-attempt-001/launch-binding.json');
  assert.equal(launch.approvalSha256, approvalSha256);
  assert.equal(launch.actualNodePath, download.executable);
  assert.equal(launch.actualNodeSha256, download.nodeSha256);
  assert.deepEqual(launch.inputHashes, approval.files);
  const supervisorBinding = local('representative-v3-attempt-001/supervisor-binding.json');
  assert.deepEqual(supervisorBinding.approval, approval);
  assert.equal(supervisorBinding.actualNodeSha256, download.nodeSha256);
  const events = lines(path.join(run, 'events.jsonl'));
  const eventCounts = histogram(events);
  const singleEvents = ['child-launch-attempt', 'child-launched', 'ready-received', 'startup-settlement', 'request-dispatch-intent', 'request-send-called', 'request-send-returned', 'request-send-callback', 'response-received', 'request-settlement', 'ipc-disconnect-request', 'ipc-disconnected', 'child-exit', 'closed-fence', 'child-cleanup-settlement'];
  assert.deepEqual(eventCounts, Object.fromEntries([...singleEvents.map(event => [event, 8]), ['closing-fence', 16], ['loopback-open', 1], ['loopback-closed', 1], ['finalization-attempt', 3], ['finalization-settlement', 3]]));
  const baseEnvironment = { PATH: `${path.dirname(download.executable)}:/usr/bin:/bin`, HOME: download.environment.HOME, TMPDIR: download.environment.TMPDIR, npm_config_cache: download.environment.npm_config_cache, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
  const oldByProfile = {};
  for (const profile of ['original', 'scratch-aligned']) oldByProfile[profile] = { cases: json(path.join(prior, profile, 'case-inputs.json')), outcomes: json(path.join(prior, profile, 'functional.json')) };
  const rows = [], pids = new Set();
  let previousCleanup = -1;
  for (const selected of plan.rows) {
    const result = local(`representative-v3-attempt-001/result-${selected.sequence}.json`);
    const journal = events.filter(entry => entry.sequence === selected.sequence);
    const identity = { sequence: selected.sequence, profile: selected.profile, recipeId: selected.id, requestId: selected.sequence };
    for (const entry of [result, ...journal]) for (const [key, value] of Object.entries(identity)) assert.equal(entry[key], value);
    assert.ok(!pids.has(result.pid)); pids.add(result.pid);
    for (const entry of journal) if ('pid' in entry) assert.equal(entry.pid, result.pid);
    let position = -1;
    for (const event of singleEvents) { const entry = only(journal, event); const index = events.indexOf(entry); assert.ok(index > position, event); position = index; }
    assert.ok(events.indexOf(only(journal, 'child-launch-attempt')) > previousCleanup);
    previousCleanup = events.indexOf(only(journal, 'child-cleanup-settlement'));
    const enginePath = path.join(closure.root, `profiles/${selected.profile}/benchmarks/expanded/engine.mjs`);
    const attempt = only(journal, 'child-launch-attempt');
    assert.equal(attempt.enginePath, enginePath);
    assert.equal(attempt.executable, download.executable);
    assert.equal(attempt.executableSha256, download.nodeSha256);
    assert.deepEqual(attempt.environment, { ...baseEnvironment, TSX_DISABLE_CACHE: '1', AUTH_CLOSURE: closure.root, AUTH_IMPORT_LOG: path.join(run, `imports-${selected.sequence}.jsonl`), NODE_OPTIONS: `--import=${closure.root}/auth-observer/observe-process.mjs`, EXPANDED_ENGINE: 'just-bash', EXPANDED_SOURCE_ROOT: closure.root, EXPANDED_BASELINE_ROOT: `${closure.root}/benchmarks/node_modules/just-bash` });
    for (const event of ['request-dispatch-intent', 'request-send-called']) { const entry = only(journal, event); assert.equal(entry.recipeSha256, selected.recipeSha256); assert.equal(entry.warmup, 0); assert.equal(entry.instrument, true); }
    assert.equal(only(journal, 'request-send-callback').success, true);
    assert.equal(only(journal, 'request-send-callback').error, null);
    assert.equal(only(journal, 'request-settlement').kind, 'response');
    assert.equal(only(journal, 'request-settlement').observationReceived, true);
    assert.equal(only(journal, 'startup-settlement').kind, 'ready');
    assert.equal(only(journal, 'ready-received').entryImportFulfilledByEngineProtocol, true);
    assert.deepEqual(only(journal, 'response-received').response, result.response);
    assert.equal(result.response.id, selected.sequence);
    assert.equal(result.response.error, undefined);
    assert.deepEqual(result.errors, []);
    assert.equal(result.hostBytes, 0);
    assert.deepEqual(result.lifecycle, { ...identity, pid: result.pid, terminal: true, spawnFailed: false, code: 0, signal: null, signals: [], errors: [], normal: true });
    const cleanup = { ...only(journal, 'child-cleanup-settlement') }; delete cleanup.event; delete cleanup.at;
    assert.deepEqual(cleanup, result.lifecycle);
    assert.equal(only(journal, 'ipc-disconnect-request').routine, true);
    const old = oldByProfile[selected.profile].outcomes.find(entry => entry.id === selected.id);
    const recipe = oldByProfile[selected.profile].cases.find(entry => entry.id === selected.id);
    assert.deepEqual(selected.recipe, recipe);
    assert.equal(hash(JSON.stringify(recipe)), selected.recipeSha256);
    assert.deepEqual(selected.expectedNative, old.expected);
    assert.equal(selected.oldBaselineStatus, old['just-bash'].status);
    assert.deepEqual(selected.oldBaselineFourFields, four(old['just-bash'].observation));
    const native = compare(result.response.observation, old.expected);
    const historical = compare(result.response.observation, old['just-bash'].observation);
    assert.deepEqual(result.comparisons, { native, oldBaseline: historical });
    assert.equal(historical.pass, true);
    const tracePath = path.join(run, `imports-${selected.sequence}.jsonl`);
    const trace = lines(tracePath);
    assert.equal(hash(bytes(tracePath)), result.trace.sha256);
    assert.equal(trace.length, result.trace.events);
    assert.ok(trace.every(entry => entry.pid === result.pid));
    const allowedTraceEvents = ['process-start', 'resolve-returned', 'load-attempt', 'load-returned', 'ipc-disconnect', 'process-exit'];
    assert.ok(trace.every(entry => allowedTraceEvents.includes(entry.event)));
    const start = only(trace, 'process-start');
    assert.deepEqual(start.argv, [download.executable, enginePath]);
    assert.deepEqual(start.execArgv, ['--expose-gc', '--unhandled-rejections=strict', '--import', 'tsx', '--max-old-space-size=256']);
    assert.equal(start.cwd, closure.root);
    assert.equal(only(trace, 'process-exit').code, 0);
    only(trace, 'ipc-disconnect');
    const pendingLoads = new Map();
    for (const entry of trace) {
      if (entry.url?.startsWith('file:')) {
        const filename = fileURLToPath(entry.url);
        assert.ok(filename.startsWith(closure.root + '/'));
        assert.ok(actualFiles[path.relative(closure.root, filename)]);
      } else if (entry.url) assert.ok(entry.url.startsWith('node:'));
      if (entry.event === 'load-attempt') {
        assert.equal(entry.filename, fileURLToPath(entry.url));
        assert.equal(entry.sha256, actualFiles[path.relative(closure.root, entry.filename)].sha256);
        pendingLoads.set(entry.url, (pendingLoads.get(entry.url) ?? 0) + 1);
      }
      if (entry.event === 'load-returned') { assert.ok(pendingLoads.get(entry.url) > 0); pendingLoads.set(entry.url, pendingLoads.get(entry.url) - 1); }
    }
    assert.ok([...pendingLoads.values()].every(count => count === 0));
    const entryUrl = pathToFileURL(`${closure.root}/benchmarks/node_modules/just-bash/dist/bundle/index.js`).href;
    const entryResolve = only(trace.filter(entry => entry.url === entryUrl), 'resolve-returned');
    assert.equal(entryResolve.specifier, entryUrl);
    assert.equal(entryResolve.parentURL, pathToFileURL(enginePath).href);
    const entryLoad = only(trace.filter(entry => entry.url === entryUrl), 'load-attempt');
    assert.equal(entryLoad.sha256, '70dd1320d921b736e965b1545e50ab57af2b2807a26de7fa624d4f519a953b7c');
    const entryReturn = only(trace.filter(entry => entry.url === entryUrl), 'load-returned');
    assert.ok(trace.indexOf(entryResolve) < trace.indexOf(entryLoad) && trace.indexOf(entryLoad) < trace.indexOf(entryReturn));
    assert.ok(Date.parse(entryReturn.at) <= Date.parse(only(journal, 'ready-received').at));
    rows.push({ ...identity, pid: result.pid, nativePass: native.pass, nativeFailedFields: native.assertions.filter(entry => !entry.pass).map(entry => entry.field), oldEquivalent: historical.pass, registryEvents: result.response.observation.registryEvents, traceCounts: histogram(trace), entryUrl, entrySha256: entryLoad.sha256 });
  }
  assert.equal(rows.filter(entry => entry.nativePass).length, 4);
  assert.deepEqual(rows.map(entry => entry.nativeFailedFields), [[], [], ['stdout'], ['stdout'], [], [], ['stderr', 'exitCode', 'entries'], ['stderr', 'exitCode']]);
  const supervisorEvents = lines(path.join(run, 'supervisor-events.jsonl'));
  assert.deepEqual(supervisorEvents.map(entry => entry.event), ['coordinator-launch-attempt', 'coordinator-launched', 'coordinator-exit', 'coordinator-pipes-closed', 'supervisor-final']);
  const coordinatorPid = supervisorEvents[1].pid;
  const supervisorPid = Number(supervisorEvents[0].environment.AUTH_SUPERVISOR_PID);
  assert.deepEqual(supervisorEvents[0].environment, { ...baseEnvironment, AUTH_SUPERVISOR_PID: String(supervisorPid), AUTH_APPROVAL_SHA256: approvalSha256 });
  assert.equal(supervisorEvents[0].executable, download.executable);
  assert.equal(supervisorEvents[1].groupId, coordinatorPid);
  assert.equal(supervisorEvents[2].code, 0);
  assert.equal(supervisorEvents[2].signal, null);
  assert.equal(supervisorEvents[4].survivors, false);
  assert.equal(new Set([...pids, coordinatorPid, supervisorPid]).size, 10);
  const summary = local('representative-v3-attempt-001/summary.json');
  const supervisor = local('representative-v3-attempt-001/supervisor-summary.json');
  for (const container of [summary, supervisor]) assert.deepEqual(container.failures, []);
  assert.equal(summary.globalExpired, false);
  assert.equal(summary.activeChildren, 0);
  assert.equal(summary.requests.length, 8);
  assert.ok(summary.finalization.every(entry => entry.success));
  assert.equal(supervisor.complete, true);
  assert.equal(supervisor.journalParseComplete, true);
  assert.equal(supervisor.groupConfirmedGone, true);
  assert.equal(supervisor.coordinatorPipesClosed, true);
  assert.equal(supervisor.spawnedCoordinators, 1);
  assert.deepEqual(supervisor.coordinatorExit, { code: 0, signal: null });
  const countMapping = { workerLaunchAttempts: 'child-launch-attempt', launchedChildren: 'child-launched', requestDispatchIntents: 'request-dispatch-intent', requestSendCalls: 'request-send-called', requestSendReturns: 'request-send-returned', requestSendThrows: 'request-send-threw', requestSettlements: 'request-settlement', startupSettlements: 'startup-settlement', responseObservations: 'response-received', cleanupSignals: 'cleanup-signal' };
  for (const [key, event] of Object.entries(countMapping)) assert.equal(summary.counts[key], eventCounts[event] ?? 0);
  for (const key of ['failedSendCallbacks', 'lateObservations', 'timeoutSettlements', 'ignoredLateMessages']) assert.equal(summary.counts[key], 0);
  assert.equal(summary.counts.successfulSendCallbacks, 8);
  assert.deepEqual(supervisor.coordinatorCounts, summary.counts);
  assert.deepEqual(supervisor.retainedJournalCounts, summary.counts);
  const network = local('representative-v3-attempt-001/network-requests.json');
  assert.deepEqual(network, Array.from({ length: 2 }, () => ({ method: 'GET', path: '/bytes', bytes: '', authorization: null })));
  const loopback = only(events, 'loopback-open');
  assert.equal(new URL(loopback.baseUrl).hostname, '127.0.0.1');
  assert.ok(events.indexOf(only(events, 'loopback-closed')) > previousCleanup);
  for (const entry of events.filter(entry => entry.event === 'finalization-settlement')) assert.equal(entry.success, true);
  const receipt = local('execution-v3-receipt.json');
  assert.equal(receipt.invocation.toolExitCode, 0);
  assert.equal(receipt.invocation.supervisorInvocations, 1);
  assert.equal(receipt.invocation.retries, 0);
  assert.equal(receipt.invocation.toolStdout, '');
  assert.equal(receipt.invocation.toolStderr, '');
  const profiles = {};
  for (const [profile, expected] of [['original', '0d534d17f3eb930c12f10d11df551ea31ec79ca4ce495e53bba91ab3abf95b39'], ['scratch-aligned', 'c6744398ee47d8ba6e975deae2b694e4e9c641d400166ac639cf797b0b623323']]) {
    const engine = bytes(path.join(closure.root, `profiles/${profile}/benchmarks/expanded/engine.mjs`));
    assert.equal(hash(engine), expected);
    const text = engine.toString('utf8');
    assert.ok(!text.includes('customCommands'));
    assert.ok(text.includes('return definition.execute(...args);'));
    assert.ok(text.indexOf('library = await import(pathToFileURL(join(baselineRoot, "dist/bundle/index.js")).href)') < text.indexOf('process.send?.({ ready: true })'));
    profiles[profile] = expected;
  }
  const graph = local('lock-graph-check.json');
  for (const root of graph.roots) {
    const frozenRoot = path.join(published.input ? published.input.frozenProductRoot : '/private/tmp/safe-bash-comparison-replay-20260827-EuLV2d/product', root.root);
    const lockFile = path.join(frozenRoot, 'package-lock.json'), hiddenFile = path.join(frozenRoot, 'node_modules/.package-lock.json');
    assert.equal(hash(bytes(lockFile)), root.lockSha256);
    assert.equal(hash(bytes(hiddenFile)), root.hiddenLockSha256);
    const lock = json(lockFile), hidden = json(hiddenFile);
    assert.equal(Object.keys(lock.packages).length, root.declaredPackageEntries);
    assert.equal(Object.keys(hidden.packages).length, root.installedPackageEntries);
    for (const [name, installed] of Object.entries(hidden.packages)) {
      const declared = lock.packages[name];
      assert.equal(installed.version, declared.version);
      assert.equal(installed.integrity, declared.integrity);
      assert.equal(installed.resolved, declared.resolved);
      assert.equal(json(path.join(frozenRoot, name, 'package.json')).version, declared.version);
    }
  }
  const dependencyTrees = local('dependency-tree-comparison.json');
  for (const dependency of dependencyTrees.roots) {
    assert.deepEqual(dependency.differences, []);
    assert.equal(dependency.files.length, dependency.count);
    for (const entry of dependency.files) {
      const fullPath = `${dependency.directory}/${entry.path}`;
      const original = frozen[fullPath];
      assert.equal(entry.sha256, original.sha256);
      assert.equal(entry.mode, original.mode & ~0o222);
      const physical = path.join('/private/tmp/safe-bash-comparison-replay-20260827-EuLV2d/product', fullPath);
      assert.equal(hash(bytes(physical)), entry.sha256);
      assert.equal(fs.lstatSync(physical).mode & 0o777, entry.mode);
    }
  }
  assert.deepEqual(tree(closure.root), actualFiles, 'execution closure changed during offline review');
  for (const [filename, expected] of inputs) assert.equal(hash(fs.readFileSync(filename)), expected.sha256, `input changed: ${filename}`);
  report.status = 'BOUNDED_AUTHENTICATED_REPRODUCTION_ACCEPTED';
  report.seals = seals;
  report.approvalSha256 = approvalSha256;
  report.sourceIdentity = { capturedHead: source.head, sourceTreeSha256: source.sourceTreeSha256, currentHeadClaim: false };
  report.package = { ...published.tarball, files: packageFiles, bytes: packageBytes };
  report.closure = { files: expectedFiles.length, baseFiles: closure.files.length, addedObservers: 2, bytes: totalBytes, mapSha256: hash(JSON.stringify(actualFiles)), stableBeforeAfterReview: true, independentlyRehashedAfterRun: true };
  report.profiles = profiles;
  report.observations = rows;
  report.counts = { observations: rows.length, distinctIds: 7, oldEquivalent: 8, nativePass: 4, nativeFail: 4, incomplete: 0, engineProcesses: pids.size, coordinatorProcesses: 1, supervisorProcesses: 1, maxConcurrentManaged: 3, managedTotal: 10, requests: 8, responses: 8, settlements: 8, routineDisconnects: 8, lateObservations: 0, exceptionalSignals: 0, capturedResidualGroup: false };
  report.events = eventCounts;
  report.supervisorEvents = histogram(supervisorEvents);
  report.lifecycle = { supervisorPid, coordinatorPid, enginePids: [...pids], supervisorExitCode: receipt.invocation.toolExitCode, supervisorExitEvidence: 'sealed author tool-exit receipt; coordinator exit/pipe/group evidence independently cross-checked in raw journals', loopback, requests: network, allManagedChildrenSettled: true };
  report.limits = ['Only just-bash package archive authenticated; other dependency bytes/lock graph equality is not publication authentication.', 'TLS metadata/hash consistency is not signature validation or source-build provenance.', 'Loader returns plus engine ready establish awaited entry completion, not universal module evaluation/CJS/WASM/thread/socket coverage.', 'Managed ledger/group disappearance is not kernel birth identity or per-guest voluntary cleanup proof.', 'Eight selected observations are not a new 224 score or extra unique coverage; incidental time/memory is not performance evidence.', 'No product/helper/native/network/control execution by this verifier.'];
} catch (error) {
  report.status = 'BLOCKED';
  report.blockers.push({ message: error.message, stack: error.stack });
  process.exitCode = 1;
}
report.inputHashes = Object.fromEntries(inputs);
report.completedAt = new Date().toISOString();
const output = path.resolve(process.argv[2] ?? '');
assert.ok(output.startsWith(own + '/'), 'owned output only');
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: report.status, counts: report.counts, blockers: report.blockers }));

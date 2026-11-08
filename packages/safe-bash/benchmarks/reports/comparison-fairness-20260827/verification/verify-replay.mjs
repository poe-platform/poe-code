import assert from 'node:assert/strict';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { bytes, compareRaw, contained, emitReport, engines, hashPattern, json, regularBytes, repo, safeRelative, sha256 } from './offline.mjs';
import { auditManaged } from './audit-managed.mjs';

const replayRelative = 'benchmarks/reports/current-integration/comparison-replay-20260827';
const groups = { command: 168, kernel: 36, composition: 12, network: 8 };
const report = { schema: 1, kind: 'OFFLINE_REPLAY_REVIEW', createdAt: new Date().toISOString(), productExecutions: 0, profiles: {}, blockers: [], limitations: [] };
let ready;
const block = (code, detail) => report.blockers.push({ code, detail });

async function bound(path) {
  safeRelative(path);
  assert.ok(path.startsWith(replayRelative + '/') || path.startsWith('benchmarks/reports/comparison-fairness-20260827/'), `out-of-scope evidence: ${path}`);
  assert.match(ready.artifactHashes[path] ?? '', hashPattern, `unbound artifact: ${path}`);
  const content = await regularBytes(resolve(repo, path));
  assert.equal(sha256(content), ready.artifactHashes[path], `artifact drift: ${path}`);
  return content;
}

const boundJson = async path => JSON.parse((await bound(path)).toString('utf8'));
const boundLines = async path => (await bound(path)).toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));

async function verifyFreeze(root, manifest) {
  const names = [];
  let totalBytes = 0;
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const file = join(directory, entry.name);
      const path = relative(root, file);
      assert.ok(!entry.isSymbolicLink(), `snapshot alias: ${path}`);
      if (entry.isDirectory()) await walk(file);
      else {
        assert.ok(entry.isFile(), `nonregular snapshot entry: ${path}`);
        const metadata = await lstat(file);
        assert.equal(metadata.nlink, 1, `shared snapshot inode: ${path}`);
        totalBytes += metadata.size;
        assert.ok(totalBytes <= 1024 * 1024 * 1024 && names.length < 20000, 'offline hash budget exceeded');
        const expected = manifest[path];
        assert.ok(expected, `unsealed snapshot addition: ${path}`);
        assert.equal(metadata.mode & 0o777, expected.mode & ~0o222, `snapshot sealed mode drift: ${path}`);
        const actual = sha256(await regularBytes(file, 128 * 1024 * 1024));
        assert.equal(actual, expected.sha256, `snapshot content drift: ${path}`);
        names.push({ path, sha256: actual });
      }
    }
  }
  await walk(root);
  assert.deepEqual(names.map(entry => entry.path).sort(), Object.keys(manifest).sort());
  return { files: names.length, bytes: totalBytes, sha256: sha256(JSON.stringify(names)) };
}

function auditCalls(events, rows, neutrality, phase) {
  const calls = new Map();
  const shutdowns = [];
  for (const event of events) {
    assert.equal(event.profile, phase, 'wrong call-ledger profile');
    assert.ok(Number.isInteger(event.pid) && event.pid > 0);
    if (event.event === 'shutdown-request') {
      const unsettled = [...calls.values()].filter(call => call.request.pid === event.pid && call.settlements.length !== 1);
      if (unsettled.length) block('SHUTDOWN_WITH_UNSETTLED_CALLS', { phase, pid: event.pid, requests: unsettled.map(call => call.request.id) });
      shutdowns.push(event);
      continue;
    }
    assert.ok(['request', 'result', 'error', 'timeout'].includes(event.event), 'unknown call event');
    assert.ok(Number.isInteger(event.id), 'missing request ID');
    const key = `${event.pid}:${event.id}`;
    if (event.event === 'request') {
      assert.ok(!calls.has(key), `duplicate IPC request: ${key}`);
      assert.ok(engines.includes(event.engine));
      assert.ok(['scored', 'neutrality'].includes(event.kind));
      calls.set(key, { request: event, settlements: [] });
    } else {
      assert.ok(calls.has(key), `settlement without request: ${key}`);
      calls.get(key).settlements.push(event);
    }
  }
  const expected = new Map();
  for (const row of rows) for (const engine of engines) expected.set(`scored:${engine}:${row.id}`, row[engine]);
  for (const row of neutrality) expected.set(`neutrality:${row.engine}:${row.id}`, row.plain);
  const observed = new Set();
  for (const call of calls.values()) {
    const key = `${call.request.kind}:${call.request.engine}:${call.request.recipeId}`;
    assert.ok(expected.has(key) && !observed.has(key), `unexpected or duplicate guest call: ${key}`);
    observed.add(key);
    if (call.settlements.length !== 1) block('UNSETTLED_OR_DUPLICATE_CALL', { phase, key, settlements: call.settlements.length });
    if (expected.get(key)?.observation) assert.equal(call.settlements[0]?.event, 'result', `captured observation without result event: ${key}`);
  }
  const missing = [...expected.keys()].filter(key => !observed.has(key));
  if (missing.length) block('MISSING_ACTUAL_CALL_PROOF', { phase, missing, noSyntheticFailures: true });
  for (const event of shutdowns) {
    if (event.reason !== 'persistent-worker-close' || event.pendingCalls !== 0) block('UNEXPECTED_WORKER_SHUTDOWN', { phase, event });
  }
  return { requests: calls.size, missing, shutdowns, status: missing.length ? 'INCOMPLETE' : 'CAPTURED', transportCallsSeparate: true };
}

try {
  assert.ok(process.argv.length === 4 || process.argv.length === 6);
  assert.equal(process.argv[2], '--ready');
  if (process.argv.length === 6) assert.equal(process.argv[4], '--out');
  ready = await json(process.argv[3]);
  assert.equal(ready.schema, 1);
  assert.equal(ready.status, 'READY_FOR_OFFLINE_REVIEW', 'active plan is not final readiness');
  assert.ok(typeof ready.rootAuthorization === 'string' && ready.rootAuthorization.length > 20);
  assert.equal(ready.replayRoot, replayRelative);
  assert.ok(ready.artifactHashes && ready.handoffs?.length >= 2);
  assert.ok(['replay', 'fairness'].every(role => ready.handoffs.some(handoff => handoff.role === role)));
  assert.equal(new Set(ready.handoffs.map(handoff => handoff.path)).size, ready.handoffs.length);
  for (const handoff of ready.handoffs) {
    assert.ok(isAbsolute(handoff.path) && /^\/(?:private\/)?tmp\/safe-bash-comparison-/u.test(handoff.path));
    assert.equal(sha256(await regularBytes(handoff.path)), handoff.sha256, 'handoff drift');
  }
  for (const path of Object.keys(ready.artifactHashes)) await bound(path);
  report.readinessSha256 = sha256(await regularBytes(process.argv[3]));
  const profileAudit = await boundJson(ready.profileAudit);
  assert.equal(profileAudit.result, 'PASS_STATIC_PROFILE_DELTA_ONLY');
  assert.equal(profileAudit.definitions.original.harness, '0294afb6e690433aed994868e5ed437ecf58ae48');
  assert.equal(profileAudit.definitions['scratch-aligned'].harness, 'd1b10a375a13f031f9f604a64395cd507f21a071');
  const location = await boundJson(`${replayRelative}/location.json`);
  const source = await boundJson(`${replayRelative}/source-manifest.json`);
  const seal = await boundJson(`${replayRelative}/seal.json`);
  const manifest = await boundJson(`${replayRelative}/frozen-files.json`);
  const profiles = await boundJson(`${replayRelative}/profiles.json`);
  const product = await realpath(ready.freezeProduct);
  assert.equal(product, resolve(location.freeze, 'product'));
  assert.match(product, /^\/private\/tmp\/safe-bash-comparison-replay-20260827-[^/]+\/product$/u);
  assert.equal(seal.sourceTreeSha256, source.sourceTreeSha256);
  assert.equal(source.sourceTreeSha256, sha256(JSON.stringify(source.paths)));
  assert.deepEqual(source.missing, []);
  assert.equal(Object.keys(source.paths).length, seal.sourceFiles);
  for (const [path, entry] of Object.entries(source.paths)) {
    safeRelative(path);
    assert.equal(manifest[path]?.sha256, entry.sha256, `source-to-freeze mismatch: ${path}`);
    assert.equal(manifest[path]?.mode, entry.mode);
  }
  assert.equal(seal.frozenFilesSha256, sha256(JSON.stringify(manifest)));
  for (const name of ['phase.mjs', 'preload.mjs', 'loader.mjs']) {
    assert.equal(sha256(await bound(`${replayRelative}/${name}`)), manifest[`audit/${name}`]?.sha256, `reviewed adapter differs from frozen adapter: ${name}`);
  }
  await bound(`${replayRelative}/supervise.mjs`);
  assert.ok((await bound(`${replayRelative}/seal.mjs`)).toString().includes('await chmod(join(source, path), entry.mode & ~0o222)'));
  report.source = { frozenHead: source.head, dirtyState: source.status, sourceTreeSha256: source.sourceTreeSha256, product, sourceFiles: seal.sourceFiles, qualification: 'same current dirty source seal for both profiles; not whole latest HEAD' };
  report.freezeBefore = await verifyFreeze(product, manifest);
  if (ready.managedQualification) report.managedQualification = await auditManaged({ bound, boundJson, boundLines, product, manifest, profiles, qualificationPath: ready.managedQualification });
  const rootPackage = await json(join(product, 'package.json'));
  assert.deepEqual(rootPackage.dependencies ?? {}, {}, 'product runtime dependencies changed');
  const baselineManifestPath = 'benchmarks/node_modules/just-bash/package.json';
  assert.equal(manifest[baselineManifestPath]?.sha256, 'b49c28900fe0640b12b9f9e9bb45feebbfa1e94b1a03b0ba7e076a0cb548f3fd');
  assert.equal(manifest['benchmarks/node_modules/just-bash/dist/bundle/index.js']?.sha256, '70dd1320d921b736e965b1545e50ab57af2b2807a26de7fa624d4f519a953b7c');
  assert.equal(manifest['benchmarks/package-lock.json']?.sha256, '6aad93176a9f7fc2578dd720802ce93a1e71b3be9dd9052ef0a54fab8bdc7d70');
  assert.equal((await json(join(product, baselineManifestPath))).version, '3.4.2');
  const controlsLifecycle = await boundJson(`${replayRelative}/controls/lifecycle.json`);
  const controlsOutput = (await bound(`${replayRelative}/controls/stdout.log`)).toString('utf8');
  const controlCounts = Object.fromEntries([...controlsOutput.matchAll(/^# (tests|pass|fail|skipped|cancelled|todo) (\d+)$/gmu)].map(match => [match[1], Number(match[2])]));
  const expectedControlTests = Object.values(profileAudit.profiles).reduce((total, profile) => total + profile.testNames.length, 0);
  assert.equal(controlCounts.tests, expectedControlTests);
  assert.equal(controlCounts.pass, expectedControlTests);
  for (const field of ['fail', 'skipped', 'cancelled', 'todo']) assert.equal(controlCounts[field], 0);
  assert.equal(controlsLifecycle.gate, 'PASS');
  assert.equal(controlsLifecycle.timedOut, false);
  assert.equal(controlsLifecycle.result.code, 0);
  assert.deepEqual(controlsLifecycle.leaked, []);
  assert.deepEqual(controlsLifecycle.remaining, []);
  assert.deepEqual(controlsLifecycle.sourceIntegrity.mismatches, []);
  assert.equal(controlsLifecycle.importAudit.pass, true);
  report.preflightControls = { counts: controlCounts, lifecycle: controlsLifecycle.gate, finishedAt: controlsLifecycle.finishedAt };
  const identitySets = [];
  for (const phase of ['original', 'scratch-aligned']) {
    const prefix = `${replayRelative}/${phase}`;
    const profile = profiles[phase];
    const audit = profileAudit.profiles[phase];
    assert.equal(profile.revision, profileAudit.definitions[phase].harness);
    assert.ok(contained(product, profile.root) && contained(profile.root, profile.harness) && contained(profile.root, profile.goldPath));
    for (const [path, expected] of Object.entries(audit.harnessFiles)) assert.equal(manifest[relative(product, resolve(profile.root, path))]?.sha256, expected, `historical harness mismatch: ${phase}/${path}`);
    for (const fixture of audit.requiredFixtures) assert.equal(manifest[relative(product, resolve(profile.root, fixture.path))]?.sha256, fixture.sha256, `missing historical fixture: ${phase}/${fixture.path}`);
    const goldBytes = await regularBytes(profile.goldPath);
    assert.equal(sha256(goldBytes), audit.goldenSha256);
    const golden = JSON.parse(goldBytes);
    const inputs = await boundJson(`${prefix}/case-inputs.json`);
    assert.deepEqual(inputs, golden.recipes, 'recipe inputs changed');
    assert.equal(inputs.length, 224);
    const rows = await boundJson(`${prefix}/functional.json`);
    assert.equal(rows.length, 224, 'incomplete capture; do not synthesize missing rows');
    assert.deepEqual(rows.map(row => row.id), inputs.map(row => row.id));
    assert.equal(new Set(rows.map(row => row.id)).size, 224);
    identitySets.push(rows.map(row => row.id));
    const expected = new Map(golden.observations.map(row => [row.id, row]));
    const totals = Object.fromEntries(engines.map(engine => [engine, { pass: 0, fail: 0, timeout: 0, 'harness-or-engine-error': 0, 'invalid-oracle': 0 }]));
    const grouped = {};
    const groupTotals = {};
    const failures = [];
    const reached = Object.fromEntries(engines.map(engine => [engine, new Set()]));
    for (const [index, row] of rows.entries()) {
      assert.equal(row.group, inputs[index].group);
      assert.equal(row.command, inputs[index].command);
      assert.equal(row.optionFamily, inputs[index].optionFamily);
      assert.deepEqual(row.expected, expected.get(row.id));
      assert.deepEqual(row.order, index % 2 ? [...engines].reverse() : engines);
      assert.equal(row.expected.recipeHash, sha256(JSON.stringify(inputs[index])));
      grouped[row.group] = (grouped[row.group] ?? 0) + 1;
      groupTotals[row.group] ??= Object.fromEntries(engines.map(engine => [engine, { pass: 0, fail: 0, timeout: 0, 'harness-or-engine-error': 0, 'invalid-oracle': 0 }]));
      for (const engine of engines) {
        const capture = row[engine];
        assert.ok(capture, `missing engine capture: ${row.id}/${engine}`);
        const comparison = capture.observation ? compareRaw(row.expected, capture.observation) : null;
        if (comparison?.serializationDisagreement) block('SERIALIZATION_DISAGREEMENT', { phase, id: row.id, engine });
        const status = !row.expected.oracleValid ? 'invalid-oracle' : capture.timeout ? 'timeout' : capture.error ? 'harness-or-engine-error' : comparison ? comparison.pass ? 'pass' : 'fail' : 'incomplete';
        assert.notEqual(status, 'incomplete', `incomplete call is not a semantic failure: ${row.id}/${engine}`);
        assert.equal(capture.status, status, `producer score mismatch: ${row.id}/${engine}`);
        totals[engine][status]++;
        groupTotals[row.group][engine][status]++;
        if (status !== 'pass') failures.push({ id: row.id, group: row.group, command: row.command, engine, status, failedFields: comparison ? Object.keys(comparison.fields).filter(field => !comparison.fields[field]) : [], routing: 'root classification required; raw terminal bytes alone do not prove internal corruption' });
        for (const event of capture.observation?.registryEvents ?? []) reached[engine].add(event.name);
      }
    }
    assert.deepEqual(grouped, groups);
    const produced = await boundJson(`${prefix}/report.json`);
    assert.equal(produced.denominator, 224);
    assert.deepEqual(produced.totals, totals);
    const intersections = {
      bothPass: rows.filter(row => engines.every(engine => row[engine].status === 'pass')).length,
      bothNonPass: rows.filter(row => engines.every(engine => row[engine].status !== 'pass')).map(row => row.id),
      virtualOnlyPass: rows.filter(row => row['virtual-bash'].status === 'pass' && row['just-bash'].status !== 'pass').map(row => row.id),
      baselineOnlyPass: rows.filter(row => row['just-bash'].status === 'pass' && row['virtual-bash'].status !== 'pass').map(row => row.id),
    };
    assert.equal(produced.bothPass, intersections.bothPass);
    assert.deepEqual(produced.bothNonPass, intersections.bothNonPass);
    const neutrality = await boundJson(`${prefix}/instrumentation-controls.json`);
    const budget = ready.controlBudgets[phase];
    assert.ok(budget && typeof budget.authorization === 'string' && budget.authorization.length > 20, 'missing distinct control authorization');
    assert.equal(neutrality.length, budget.neutralityCalls);
    assert.equal(new Set(neutrality.map(row => `${row.engine}:${row.id}`)).size, neutrality.length);
    for (const row of neutrality) {
      const traced = rows.find(candidate => candidate.id === row.id)?.[row.engine]?.observation;
      const result = row.plain?.observation && traced ? compareRaw(traced, row.plain.observation).pass : false;
      assert.equal(row.pass, result);
      if (!result) block('INSTRUMENTATION_NOT_NEUTRAL', { phase, id: row.id, engine: row.engine });
    }
    const transport = await boundJson(`${prefix}/transport-controls.json`);
    assert.equal(transport.rows.length, budget.transportCalls);
    const transportInputs = { 'invalid-utf8': Buffer.from([128, 255]), utf8: Buffer.from('é😀'), 'nul-ascii': Buffer.from([0, 65, 10]) };
    assert.equal(new Set(transport.rows.map(row => `${row.name}:${row.script}`)).size, transport.rows.length);
    for (const row of transport.rows) {
      assert.ok(transportInputs[row.name]);
      assert.deepEqual(bytes(row.input), transportInputs[row.name]);
      assert.ok(['cat', 'cat | base64', 'cat > output'].includes(row.script));
      const expectedBytes = row.script === 'cat' ? transportInputs[row.name] : row.script === 'cat | base64' ? Buffer.from(transportInputs[row.name].toString('base64') + '\n') : Buffer.alloc(0);
      assert.deepEqual(bytes(row.expected), expectedBytes);
      assert.equal(row.pass, bytes(row.stdout).equals(expectedBytes) && row.exitCode === 0 && row.stderr === '');
      if (row.script === 'cat > output') assert.equal(row.fileBytesMatch, bytes(row.output).equals(transportInputs[row.name]));
    }
    const lifecycle = await boundJson(`${prefix}/lifecycle.json`);
    assert.ok(Number.isFinite(Date.parse(lifecycle.startedAt)) && Date.parse(controlsLifecycle.finishedAt) <= Date.parse(lifecycle.startedAt), 'controls not complete before once-only profile');
    const cleanup = await boundJson(`${prefix}/phase-cleanup.json`);
    const events = await boundLines(`${prefix}/imports.jsonl`);
    const loads = events.filter(event => event.event === 'module-load');
    for (const load of loads) {
      assert.ok(contained(product, load.actual), `outside module load: ${load.actual}`);
      assert.equal(manifest[relative(product, load.actual)]?.sha256, load.sourceSha256);
    }
    assert.ok(loads.length > 0);
    const children = events.filter(event => event.event === 'child-start');
    const exits = events.filter(event => event.event === 'child-exit');
    const workerPids = new Set(events.filter(event => event.event === 'process-start' && event.argv?.some(argument => argument.endsWith('/engine.mjs'))).map(event => event.pid));
    const shutdownKinds = [];
    for (const child of children) {
      const end = exits.filter(event => event.childPid === child.childPid && event.pid === child.pid);
      if (end.length !== 1) block('CHILD_EXIT_PROOF_INCOMPLETE', { phase, pid: child.childPid, exits: end.length });
      shutdownKinds.push({ pid: child.childPid, code: end[0]?.code ?? null, signal: end[0]?.signal ?? null });
      if (end[0]?.signal && end[0].signal !== 'SIGTERM') block('UNEXPECTED_CHILD_SIGNAL', { phase, pid: child.childPid, signal: end[0].signal });
      if (end[0]?.code !== null && end[0]?.code !== undefined && end[0].code !== 0) block('CHILD_NONZERO_EXIT', { phase, pid: child.childPid, code: end[0].code });
    }
    const ledgerPath = ready.callLedgers?.[phase];
    let calls = null;
    if (ledgerPath) calls = auditCalls(await boundLines(ledgerPath), rows, neutrality, phase);
    else if (report.managedQualification?.result === 'BOUNDED_MANAGED_CLEANUP_SUPPORTED') report.limitations.push(`${phase}: no IPC/shutdown ledger. Root-approved narrower managed cleanup is supported by sealed serial-await code, complete observations, child exits and outer census; not voluntary guest/thread cleanup.`);
    else block('CALL_AND_SHUTDOWN_LEDGER_MISSING', { phase, message: 'SIGTERM may be routine session closure; no blanket success or guest-retention inference without call/termination provenance' });
    if (calls) for (const shutdown of shutdownKinds.filter(item => workerPids.has(item.pid) && item.signal === 'SIGTERM')) {
      if (!calls.shutdowns.some(event => event.pid === shutdown.pid && event.reason === 'persistent-worker-close' && event.pendingCalls === 0)) block('ROUTINE_SIGTERM_NOT_PROVEN', { phase, pid: shutdown.pid });
    }
    if (lifecycle.gate !== 'PASS' || lifecycle.timedOut || lifecycle.result?.code !== 0 || lifecycle.leaked?.length || lifecycle.remaining?.length || lifecycle.sourceIntegrity?.mismatches?.length || !lifecycle.importAudit?.pass || !cleanup.sessionsClosed || !cleanup.serverClosed) block('LIFECYCLE_GATE_FAILED', { phase, lifecycle, cleanup });
    for (const stage of ['before', 'after']) {
      const integrity = await boundJson(`${prefix}/integrity-${stage}.json`);
      assert.deepEqual(integrity.mismatches, []);
      assert.equal(integrity.expectedTreeSha256, seal.frozenFilesSha256);
    }
    const inventory = await boundJson(`${prefix}/inventory.json`);
    const dispatch = await boundJson(`${prefix}/dispatch.json`);
    for (const engine of engines) assert.deepEqual(dispatch.reached[engine], [...reached[engine]].sort());
    assert.deepEqual(dispatch.requiredUnshadowed, inventory.virtual.unshadowedRegistry);
    assert.deepEqual(dispatch.missingUnshadowed, inventory.virtual.unshadowedRegistry.filter(name => !reached['virtual-bash'].has(name)));
    report.profiles[phase] = { rows: 224, groups: grouped, groupTotals, totals, intersections, failures, controlsSeparate: { neutralityCalls: neutrality.length, transportCalls: transport.rows.length, transportFailures: transport.rows.filter(row => !row.pass).map(row => ({ name: row.name, script: row.script, fileBytesMatch: row.fileBytesMatch ?? null })) }, dispatch, calls, lifecycle: { producerGate: lifecycle.gate, shutdownKinds, attemptedFileLoadEvents: loads.length, proofLimit: 'module-load event precedes nextLoad in inspected loader; successful evaluation and handler dispatch are distinct' } };
  }
  assert.deepEqual(identitySets[0], identitySets[1]);
  report.distinctRecipeIds = 224;
  report.profileCount = 2;
  report.denominatorPolicy = 'Two profiles of224 IDs; not448 unique coverage. Baseline-only136 observations and historical performance excluded.';
  report.freezeAfter = await verifyFreeze(product, manifest);
  assert.deepEqual(report.freezeAfter, report.freezeBefore);
  for (const path of Object.keys(ready.artifactHashes)) await bound(path);
  report.result = report.blockers.length ? 'RAW_SCORES_RECOMPUTED_ACCEPTANCE_BLOCKED' : 'OFFLINE_CHECKS_COMPLETE_REQUIRES_HUMAN_FAIRNESS_REVIEW';
} catch (error) {
  block('INCOMPLETE_OR_MISMATCHED_EVIDENCE', { message: error.message, stack: error.stack });
  report.result = 'BLOCKED_NO_SYNTHETIC_SCORES';
}
report.limitations.push('No product, native, performance or recipe execution. No claim about current live HEAD. Public terminal-byte API failures remain separate from internal pipe/file effects. No automatic whole-comparison acceptance.');
if (report.blockers.length) process.exitCode = 1;
await emitReport(report, process.argv[4] === '--out' ? process.argv[5] : undefined);

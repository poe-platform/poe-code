import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, realpathSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const own = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(own, '../../../../');
const freeze = resolve(own, '../measurement-freeze');
const executor = resolve(own, '../measurement');
const raw = '/private/tmp/safe-bash-measurement-freeze-XAFOrN/measurement-attempt-001';
const candidate = 'e33974b8c643077453227a9679d8ceca8367998c';
const receiptPin = 'c0f9468f33d1df5ec468bc98830c06fc8fcadb797f3595b0a7fa18f346f607a5';
const bindingPin = '1c74655402eba80a12e1c190fa43ba6923faace8a7db81c7f17da8a3b4528b1e';
const output = process.argv[2];
assert.match(output ?? '', /^[a-z0-9-]+$/u, 'explicit new evidence prefix required');
const hash = value => createHash('sha256').update(value).digest('hex');
const stableMetadata = metadata => [metadata.dev, metadata.ino, metadata.mode, metadata.nlink, metadata.size, metadata.mtimeMs, metadata.ctimeMs];
const visited = new Map();
const artifactHashes = {};
let readBytes = 0;
function read(filename, expected) {
  filename = resolve(filename);
  assert.equal(realpathSync(filename), filename);
  const before = lstatSync(filename);
  assert.ok(before.isFile() && before.nlink === 1 && before.size <= 256 * 1024 * 1024, filename);
  const bytes = readFileSync(filename);
  assert.deepEqual(stableMetadata(lstatSync(filename)), stableMetadata(before), filename);
  const sha256 = hash(bytes);
  if (expected) {
    assert.equal(sha256, expected.sha256, filename);
    assert.equal(bytes.length, expected.bytes, filename);
  }
  visited.set(filename, stableMetadata(before));
  artifactHashes[filename] = { bytes: bytes.length, sha256 };
  readBytes += bytes.length;
  return bytes;
}
const json = (filename, expected) => JSON.parse(read(filename, expected));
const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: root, env: { PATH: '/usr/bin:/bin' }, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
const save = (name, value) => writeFileSync(join(own, `${output}-${name}.json`), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const count = values => Object.fromEntries([...new Set(values)].sort().map(value => [value, values.filter(item => item === value).length]));
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
function bytes(value) {
  assert.equal(typeof value, 'string');
  const decoded = Buffer.from(value, 'base64');
  assert.equal(decoded.toString('base64'), value);
  return decoded;
}
function stableEntry(entry) {
  return { path: entry.path, type: entry.type, ...(entry.mode === undefined ? {} : { mode: entry.mode & 0o7777 }), ...(entry.base64 === undefined ? {} : { base64: entry.base64 }), ...(entry.target === undefined ? {} : { target: entry.target }) };
}
function effects(before, after) {
  if (!before || !after) return null;
  const previous = new Map(before.entries.map(entry => [entry.path, stableEntry(entry)]));
  const next = new Map(after.entries.map(entry => [entry.path, stableEntry(entry)]));
  return [...new Set([...previous.keys(), ...next.keys()])].sort().filter(path => JSON.stringify(previous.get(path)) !== JSON.stringify(next.get(path))).map(path => ({ path, before: previous.get(path) ?? null, after: next.get(path) ?? null }));
}
function intent(specimen, report) {
  if (!report || report.captureErrors.length || report.executionError) return { matched: null, checks: [], effects: effects(report?.before, report?.after) };
  const checks = [];
  const check = (label, passes) => checks.push({ label, passes });
  check('complete before/after VFS census', report.before?.complete === true && report.after?.complete === true);
  const result = report.result, expected = specimen.expected;
  if (expected) {
    check('exit status', result.exitCode === expected.exitCode);
    for (const channel of ['stdoutBase64', 'stderrBase64']) if (channel in expected) check(channel, result[channel] === expected[channel]);
    for (const text of expected.stdoutIncludes ?? []) check(`stdout includes ${JSON.stringify(text)}`, result.stdout.includes(text));
    for (const text of expected.stdoutExcludes ?? []) check(`stdout excludes ${JSON.stringify(text)}`, !result.stdout.includes(text));
    if (expected.elapsedAtLeastMs !== undefined) check('loose product-exec sleep lower bound', report.productElapsedMs >= expected.elapsedAtLeastMs);
    const after = new Map(report.after.entries.map(entry => [entry.path, entry]));
    for (const [name, requirement] of Object.entries(expected.files)) {
      const entry = after.get(`/fixture/${name}`), data = bytes(entry?.base64 ?? '');
      check(`file exists: ${name}`, entry?.type === 'file');
      if (requirement.base64 !== undefined) check(`file bytes: ${name}`, entry?.base64 === requirement.base64);
      if (requirement.prefixBase64 !== undefined) check(`file prefix: ${name}`, data.subarray(0, bytes(requirement.prefixBase64).length).toString('base64') === requirement.prefixBase64);
      if (requirement.minBytes !== undefined) check(`file minimum bytes: ${name}`, data.length >= requirement.minBytes);
      for (const text of requirement.includes ?? []) check(`file contains ${text}: ${name}`, data.includes(Buffer.from(text)));
    }
    for (const name of expected.absent) check(`path absent: ${name}`, !after.has(`/fixture/${name}`));
    if (expected.preserveInputs) for (const entry of report.before.entries.filter(value => value.path.startsWith('/fixture/') || value.path.startsWith('/tmp/'))) {
      const current = after.get(entry.path);
      check(`preserve input: ${entry.path}`, current !== undefined && JSON.stringify(stableEntry(current)) === JSON.stringify(stableEntry(entry)));
    }
    for (const [name, fixture] of Object.entries(specimen.files)) {
      const initial = report.before.entries.find(entry => entry.path === `/fixture/${name}`);
      check(`fixture initial bytes: ${name}`, initial?.base64 === fixture.base64);
      if (fixture.mode !== undefined) check(`fixture initial mode: ${name}`, (initial?.mode & 0o7777) === fixture.mode);
    }
    for (const [name, target] of Object.entries(specimen.symlinks)) {
      const initial = report.before.entries.find(entry => entry.path === `/fixture/${name}`);
      check(`fixture initial symlink: ${name}`, initial?.type === 'symlink' && initial.target === target);
    }
  }
  const missing = new RegExp(`${specimen.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: (?:command )?not found`).test(result.stderr);
  let classification = 'partial-functionality';
  if ((specimen.prerequisites ?? []).some(name => result.stderr.includes(`${name}: command not found`))) classification = 'dependency-blocked';
  else if (missing && result.exitCode === 127) classification = 'missing-handler';
  else if (report.engine === 'ours' && result.exitCode === 2 && /unsupported parameter expansion|unexpected token|Background execution/i.test(result.stderr)) classification = 'syntax-blocked-before-target';
  else if (specimen.cohort === 'direct-diagnostic') classification = 'direct-target-observed-no-functional-credit';
  else if (specimen.name === 'node' && report.engine === 'baseline') classification = 'baseline-stub';
  else if (['js-exec', 'python', 'python3', 'sqlite3'].includes(specimen.name) && result.exitCode !== 0 && /worker|wasm|runtime|module|security|initializ|timed out/i.test(result.stderr)) classification = 'optional-runtime-unavailable';
  else if (specimen.name === 'help') classification = 'documentation-only';
  else if (specimen.name === 'wait') classification = 'no-op-not-operational-proof';
  else if (checks.every(check => check.passes)) classification = 'functional-positive';
  return { matched: expected === null ? null : checks.every(check => check.passes), classification, checks, effects: effects(report.before, report.after) };
}

const binding = json(join(freeze, 'execution-binding.json'));
assert.equal(artifactHashes[join(freeze, 'execution-binding.json')].sha256, bindingPin);
const receipt = json(join(freeze, 'proposed-root-receipt.json'));
assert.equal(artifactHashes[join(freeze, 'proposed-root-receipt.json')].sha256, receiptPin);
assert.equal(binding.candidate.commit, candidate);
assert.equal(receipt.bindingSha256, bindingPin);
assert.equal(git('rev-parse', `${candidate}^{tree}`).toString().trim(), binding.candidate.gitTree);
const manifest = json(join(executor, 'RAW_MANIFEST.json'));
assert.equal(manifest.root, raw);
assert.equal(manifest.files.length, 2071);
assert.deepEqual(readdirSync(raw).sort(), manifest.files.map(record => record.path).sort());
const records = new Map(manifest.files.map(record => [record.path, record]));
assert.equal(records.size, manifest.files.length);
const rawJson = name => json(join(raw, name), records.get(name));
const rawReceipt = rawJson('binding-receipt.json');
assert.equal(rawReceipt.receiptSha256, receiptPin);
assert.equal(rawReceipt.bindingSha256, bindingPin);
assert.deepEqual(rawReceipt.candidate, binding.candidate);
const input = rawJson('exact-inputs.json');
const runnerCohorts = json(join(freeze, 'runner-cohort-bindings.json'));
for (const [group, directory] of [['runner', 'execution'], ['cohorts', 'cohorts']]) for (const record of runnerCohorts[group].files) {
  const data = read(join(runnerCohorts[group].root, record.path), record);
  const blob = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
  assert.equal(blob, git('rev-parse', `${candidate}:benchmarks/reports/current-comparison-20260827/${directory}/${record.path}`).toString().trim());
}
const cohortRoot = runnerCohorts.cohorts.root;
for (const [name, sha256] of Object.entries(binding.seals)) {
  const seal = json(join(cohortRoot, name));
  assert.equal(artifactHashes[join(cohortRoot, name)].sha256, sha256);
  for (const record of seal.files) read(join(cohortRoot, record.path), record);
}
const original = json(join(cohortRoot, 'historical-224.json'));
const breadth = json(join(cohortRoot, 'historical-breadth.json'));
const profiles = json(join(cohortRoot, 'profiles.json'));
const plan = [];
for (const profile of ['original', 'aligned']) for (const [index, row] of original.entries()) {
  assert.equal(hash(canonical(row.recipe)), row.recipeCanonicalSha256);
  assert.equal(hash(canonical(row.input)), row.inputCanonicalSha256);
  for (const key of ['originalOracle', 'alignedOracle']) assert.equal(hash(canonical(row[key].observation)), row[key].canonicalSha256);
  for (const engine of index % 2 ? ['just-bash', 'virtual-bash'] : ['virtual-bash', 'just-bash']) plan.push({ profile, engine, id: row.id, specimen: row.recipe, expected: row[profile === 'original' ? 'originalOracle' : 'alignedOracle'].observation, recipeHash: hash(JSON.stringify(row.recipe)) });
}
const orderedBreadth = [...breadth.filter(row => row.recipe.cohort.startsWith('shared')), ...breadth.filter(row => row.recipe.cohort !== 'direct-diagnostic' && !row.recipe.cohort.startsWith('shared')), ...breadth.filter(row => row.recipe.cohort === 'direct-diagnostic')];
for (const row of orderedBreadth) {
  assert.equal(hash(canonical(row.recipe)), row.recipeCanonicalSha256);
  assert.equal(hash(canonical(row.input)), row.inputCanonicalSha256);
  const { inputSha256, ...effective } = row.recipe;
  assert.equal(hash(JSON.stringify(effective)), inputSha256);
  for (const engine of ['virtual-bash', 'just-bash']) plan.push({ profile: 'breadth', engine, id: row.id, specimen: row.recipe, recipeHash: hash(JSON.stringify(row.recipe)) });
}
assert.deepEqual(input, plan);
assert.equal(plan.length, 1032);
assert.equal(new Set(plan.map(row => [row.profile, row.engine, row.id].join('/'))).size, 1032);
const sourceInventory = json(join(binding.candidate.sourceInventory.root, binding.candidate.sourceInventory.path), binding.candidate.sourceInventory);
const build = '/private/tmp/safe-bash-measurement-freeze-XAFOrN/build/source';
for (const record of sourceInventory.files) read(join(build, record.path), record);
for (const record of [binding.candidate.source, binding.candidate.pack, binding.baselineTar, binding.node]) read(join(record.root, record.path), record);
const post = rawJson('post-membership.json');
const boundFiles = new Map();
for (const [name, closure, after] of [['runner', binding.runner, post.runner], ...Object.entries(binding.engines).map(([name, engine]) => [name, engine.closure, post.engines[name]])]) {
  const expected = Object.fromEntries(closure.files.map(record => [join(closure.root, record.path), { bytes: record.bytes, sha256: record.sha256 }]));
  assert.deepEqual(after.files, expected, name);
  const seen = [];
  function visit(directory) {
    for (const name of readdirSync(directory)) {
      const filename = join(directory, name), metadata = lstatSync(filename);
      assert.ok(!metadata.isSymbolicLink());
      if (metadata.isDirectory()) visit(filename); else { assert.ok(metadata.isFile()); seen.push(filename); }
    }
  }
  if (name !== 'runner') { visit(closure.root); assert.deepEqual(seen.sort(), Object.keys(expected).sort()); }
  for (const record of closure.files) {
    const filename = join(closure.root, record.path);
    read(filename, record); boundFiles.set(filename, record);
  }
}
const recordedTables = Object.fromEntries(['original', 'aligned', 'breadth'].map(profile => [profile, rawJson(`${profile}.json`)]));
const rows = [], imported = new Map(), publicImports = new Map(), cleanup = [], networks = [], wireCounts = [], nonces = new Set();
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { assert.equal(error.code, 'ESRCH'); return false; } };
for (const [index, selection] of plan.entries()) {
  const name = `attempt-${String(index + 1).padStart(4, '0')}.json`;
  const record = rawJson(name), attempt = record.attempt;
  assert.deepEqual([record.profile, record.engine, record.caseId, record.recipeHash], [selection.profile, selection.engine, selection.id, selection.recipeHash], name);
  assert.deepEqual([attempt.profile, attempt.engine, attempt.id, attempt.synthetic], [selection.profile, selection.engine, selection.id, false]);
  assert.ok(!nonces.has(attempt.nonce)); nonces.add(attempt.nonce);
  const journal = read(join(raw, name.replace('.json', '.jsonl')), records.get(name.replace('.json', '.jsonl'))).toString();
  assert.deepEqual(journal.trimEnd().split('\n').map(line => JSON.parse(line)), attempt.events, name);
  assert.equal(attempt.result.id, selection.id); assert.equal(attempt.result.nonce, attempt.nonce);
  const event = kind => attempt.events.filter(entry => entry.kind === kind);
  assert.equal(event('result-received').length, 1);
  assert.equal(event('result-received')[0].sha256, hash(JSON.stringify(attempt.result)));
  const wire = [];
  for (const entry of attempt.events) {
    let message;
    if (entry.kind === 'result-received') message = attempt.result;
    else if (entry.id !== undefined) { const { atMs, ...rest } = entry; message = rest; }
    if (message) {
      assert.equal(message.id, selection.id); assert.equal(message.nonce, attempt.nonce);
      const body = Buffer.from(JSON.stringify(message)), header = Buffer.alloc(4); header.writeUInt32BE(body.length);
      wire.push(header, body);
    }
  }
  const reconstructed = Buffer.concat(wire);
  assert.equal(reconstructed.length, attempt.wireCapture.receivedBytes, name);
  assert.equal(hash(reconstructed), attempt.wireCapture.receivedSha256, name);
  assert.equal(reconstructed.subarray(0, 4096).toString('base64'), attempt.wireCapture.prefixBase64, name);
  wireCounts.push(reconstructed.length);
  const admission = event('group-admitted'); assert.equal(admission.length, 1);
  assert.deepEqual(admission[0].host, binding.host);
  assert.deepEqual(admission[0].argv, [join(binding.node.root, binding.node.path), '--unhandled-rejections=strict', join(binding.runner.root, 'session.mjs')]);
  assert.equal(admission[0].pid, attempt.coordinatorPid); assert.equal(admission[0].pgid, attempt.coordinatorPid);
  assert.equal(event('engine-spawn').length, 1); assert.equal(event('engine-spawn')[0].pid, attempt.enginePid);
  assert.deepEqual(event('engine-spawn')[0].argv, [join(binding.node.root, binding.node.path), '--unhandled-rejections=strict', '--experimental-import-meta-resolve', '--max-old-space-size=256', join(binding.runner.root, 'engine-child.mjs')]);
  const requiredPhases = ['exec-start', 'exec-settled', 'snapshot-complete', 'dispose-start', 'dispose-settled'];
  const phases = event('phase').map(entry => entry.phase);
  assert.deepEqual(phases.filter(phase => requiredPhases.includes(phase)), requiredPhases);
  assert.deepEqual(attempt.execAdmissions, { scoredCase: 1, emptyInitialization: selection.profile !== 'breadth' && selection.engine === 'virtual-bash' ? 1 : 0 });
  assert.equal(phases.filter(phase => phase === 'initialization-exec').length, attempt.execAdmissions.emptyInitialization);
  const optional = ['javascript', 'python', 'sqlite'].includes(selection.specimen.configuration);
  const guestLimit = selection.profile === 'breadth' ? optional ? 120000 : 30000 : 5000;
  const totalLimit = selection.profile === 'breadth' ? optional ? 140000 : 50000 : 28000;
  assert.equal(attempt.deadlinesMs.total, totalLimit);
  assert.equal(Math.round(event('result-received')[0].absoluteTotalUnchangedMs * 1000) / 1000, totalLimit);
  assert.ok(event('phase').find(entry => entry.phase === 'exec-settled').atMs - event('phase').find(entry => entry.phase === 'exec-start').atMs <= guestLimit);
  assert.ok(attempt.hostBytes <= 65536 && attempt.reportBytes <= 67108864 && attempt.events.length <= 4128);
  assert.equal(attempt.rejectedFrames?.length ?? 0, 0);
  const engine = binding.engines[selection.engine], entryPath = join(engine.closure.root, engine.entry), entryURL = pathToFileURL(entryPath).href;
  assert.equal(event('public-resolution').length, 1); assert.equal(event('entry-import-fulfilled').length, 1);
  const resolution = event('public-resolution')[0];
  assert.deepEqual([resolution.specifier, resolution.parent, resolution.resolved], [selection.engine, join(engine.closure.root, engine.packageJson), entryURL]);
  assert.equal(event('entry-import-fulfilled')[0].resolved, entryURL);
  publicImports.set(selection.engine, (publicImports.get(selection.engine) ?? 0) + 1);
  let entryLoaded = false;
  for (const message of event('module')) {
    const observation = message.event;
    if (observation.type === 'load-returned') {
      const filename = fileURLToPath(observation.url);
      assert.equal(observation.sha256, boundFiles.get(filename)?.sha256, filename);
      assert.equal(observation.evaluationProven, false);
      if (observation.url === entryURL) entryLoaded = true;
      const key = JSON.stringify(observation);
      imported.set(key, (imported.get(key) ?? 0) + 1);
    } else if (observation.url.startsWith('file:')) assert.ok(boundFiles.has(fileURLToPath(observation.url)), observation.url);
  }
  assert.ok(entryLoaded, name);
  const processGone = !alive(attempt.enginePid), groupGone = !alive(-attempt.coordinatorPid), coordinatorGone = !alive(attempt.coordinatorPid);
  assert.ok(processGone && groupGone && coordinatorGone, name);
  assert.equal(attempt.groupGone, true);
  const natural = ['engineExit', 'engineClose', 'sessionExit', 'sessionClose'].every(key => attempt[key]?.code === 0 && attempt[key]?.signal === null);
  const fixture = event('fixture-close')[0];
  const lifecycle = attempt.failures.length === 0 && attempt.signals.length === 0 && natural && event('session-complete').length === 1 && fixture?.closed === true && !fixture.failed && fixture.sockets === 0;
  assert.equal(attempt.clean, lifecycle, name); assert.equal(record.assessment.lifecycle, lifecycle);
  const isNetwork = selection.profile === 'breadth' ? selection.specimen.configuration === 'loopback-network' : selection.specimen.network;
  if (isNetwork) { assert.ok(fixture.closed && fixture.sockets === 0 && !fixture.failed); networks.push({ evidence: name, profile: selection.profile, engine: selection.engine, id: selection.id, closed: true, sockets: 0, requests: fixture.requests }); }
  cleanup.push({ evidence: name, id: selection.id, engine: selection.engine, profile: selection.profile, coordinatorPid: attempt.coordinatorPid, enginePid: attempt.enginePid, groupGone, processGone, coordinatorGone, lifecycle, natural, fixtureClosureRecorded: Boolean(fixture), signals: attempt.signals, failures: attempt.failures, engineExit: attempt.engineExit, engineClose: attempt.engineClose, sessionExit: attempt.sessionExit, sessionClose: attempt.sessionClose });
  const row = { id: selection.id, profile: selection.profile, engine: selection.engine, evidence: name, evidenceSha256: records.get(name).sha256, recipeHash: selection.recipeHash, lifecycle, signals: attempt.signals, lifecycleFailures: attempt.failures };
  if (selection.profile === 'breadth') {
    const report = attempt.result.report, predicate = intent(selection.specimen, report);
    assert.equal(report.caseId, selection.id); assert.equal(report.engine, selection.engine === 'virtual-bash' ? 'ours' : 'baseline');
    assert.deepEqual(report.configuration, profiles.breadth.configurations[report.engine][selection.specimen.configuration]);
    const result = report.result;
    bytes(result.stdoutBase64); bytes(result.stderrBase64);
    for (const census of [report.before, report.after]) for (const entry of census.entries) if (entry.base64 !== undefined) bytes(entry.base64);
    const timedOut = attempt.failures.some(reason => /deadline|timeout/u.test(reason));
    if (timedOut || !report || attempt.engineExit?.code !== 0 || attempt.engineExit?.signal) {
      assert.equal(record.assessment.historical.classification, timedOut ? 'timeout' : 'harness-error');
      assert.equal(record.assessment.historical.operationalCredit, false);
    } else if (!report.captureErrors.length && !report.executionError) {
      assert.deepEqual(record.assessment.historical.checks.map(({ label, passes }) => ({ label, passes })), predicate.checks);
      assert.deepEqual(record.assessment.historical.effects, predicate.effects);
      assert.equal(record.assessment.historical.expectationSatisfied, predicate.matched);
      assert.equal(record.assessment.historical.classification, predicate.classification);
    }
    const credit = lifecycle && !report.cleanup?.error && predicate.classification === 'functional-positive' && selection.specimen.operationalCredit !== false;
    assert.equal(record.assessment.operationalCredit, credit, name);
    const partition = selection.specimen.cohort === 'direct-diagnostic' ? 'diagnostics' : ['historical-unmeasured', 'additional-optional'].includes(selection.specimen.cohort) ? 'targets' : 'controls';
    if (partition === 'diagnostics') assert.equal(credit, false);
    Object.assign(row, { partition, cohort: selection.specimen.cohort, predicateMatched: predicate.matched, operationalCredit: credit, status: record.assessment.status, rawClassification: predicate.classification, failedChecks: predicate.checks.filter(check => !check.passes).map(check => check.label), raw: result, effects: predicate.effects, captureErrors: report.captureErrors, executionError: report.executionError ?? null, cleanupError: report.cleanup?.error ?? null });
  } else {
    const observed = attempt.result.observation, expected = selection.expected;
    const assertions = ['stdout', 'stderr', 'exitCode', 'entries'].map(field => ({ field, pass: JSON.stringify(expected[field]) === JSON.stringify(observed[field]) }));
    const matched = assertions.every(assertion => assertion.pass);
    assert.deepEqual(record.assessment.comparison, { pass: matched, assertions });
    bytes(observed.stdout); bytes(observed.stderr); bytes(observed.raw.stdoutBase64); bytes(observed.raw.stderrBase64);
    for (const entry of Object.values(observed.entries)) if (entry.bytes !== undefined) bytes(entry.bytes);
    assert.deepEqual([observed.stdout, observed.stderr], [observed.raw.stdoutBase64, observed.raw.stderrBase64], 'actual raw and projected channels happen to coincide in this run');
    assert.equal(observed.dispatchObservation, 'not instrumented; no command replacement');
    assert.deepEqual(observed.events, []); assert.deepEqual(observed.registryEvents, []);
    const status = expected.oracleValid === false ? 'invalid-oracle' : !lifecycle ? 'lifecycle-or-capture-failure' : attempt.result.error ? 'harness-or-engine-error' : matched ? 'pass' : 'fail';
    assert.equal(record.assessment.status, status);
    Object.assign(row, { predicateMatched: matched, status, oracleValid: expected.oracleValid, failedFields: assertions.filter(assertion => !assertion.pass).map(assertion => assertion.field), expected: { stdoutBase64: expected.stdout, stderrBase64: expected.stderr, exitCode: expected.exitCode, entriesSha256: hash(JSON.stringify(expected.entries)) }, raw: { ...observed.raw, exitCode: observed.exitCode }, projected: { stdoutBase64: observed.stdout, stderrBase64: observed.stderr, entriesSha256: hash(JSON.stringify(observed.entries)) }, capture: observed.capture });
  }
  const listed = recordedTables[selection.profile].observations.find(entry => entry.evidence === name);
  assert.deepEqual(listed.assessment, record.assessment); assert.equal(listed.id, selection.id); assert.equal(listed.engine, selection.engine);
  rows.push(row);
}

for (const [profile, expectedCount] of [['original', 448], ['aligned', 448], ['breadth', 136]]) {
  assert.equal(recordedTables[profile].observations.length, expectedCount); assert.equal(recordedTables[profile].complete, true);
  assert.equal(recordedTables[profile].unionScore, null);
}
const summary = rawJson('summary.json'); assert.equal(summary.stopped, null);
assert.deepEqual(summary.actual, { original: 448, aligned: 448, breadth: 136 });
const completion = json(join(executor, 'driver-completion.json'));
const runReceipt = json(join(executor, 'run-receipt.json'));
const launch = json(join(executor, 'launch-intent.json'));
const commandFile = read(join(freeze, 'NEXT_COMMAND.txt'));
assert.equal(hash(commandFile), launch.commandFileSha256);
assert.equal(commandFile.toString().trimEnd().split('\n')[1], launch.command);
assert.equal(launch.command, runReceipt.exactCommand);
assert.equal(hash(launch.command), runReceipt.commandSha256);
assert.equal(launch.adoptedRootReceipt, true);
for (const [filename, expected] of Object.entries(launch.before)) read(filename, expected);
assert.equal(runReceipt.candidate, candidate); assert.equal(runReceipt.bindingSha256, bindingPin); assert.equal(runReceipt.rootReceiptSha256, receiptPin);
assert.deepEqual(completion.exit, { code: 0, signal: null }); assert.deepEqual(completion.close, completion.exit);
assert.deepEqual(completion.wrapperSignalsSent, []); assert.equal(completion.spawnError, null); assert.equal(completion.postHashError, null);
assert.ok(!alive(runReceipt.commandProcessPid) && !alive(-runReceipt.commandProcessGroup) && !alive(runReceipt.wrapperPid));
for (const channel of ['stdout', 'stderr']) {
  const data = read(join(executor, `driver.${channel}`));
  assert.equal(data.length, completion[channel].receivedBytes); assert.equal(hash(data), completion[channel].receivedSha256); assert.equal(completion[channel].overflow, false);
}
for (const [filename, expected] of Object.entries(completion.after)) read(filename, expected);
const sourceAfter = json(join(executor, 'SOURCE_AFTER.json'));
for (const record of sourceAfter.sourceProof) read(record.path, record);
const executorImports = json(join(executor, 'IMPORT_IDENTITIES.json'));
assert.deepEqual(new Map(executorImports.loads.map(({ observations, ...record }) => [JSON.stringify(record), observations])), imported);
const executorCleanup = json(join(executor, 'CLEANUP.json'));
assert.equal(executorCleanup.processes.length, cleanup.length);
for (const record of executorCleanup.processes) {
  const actual = cleanup.find(row => row.evidence === record.evidence);
  assert.equal(record.lifecycleClean, actual.lifecycle); assert.equal(record.coordinatorPid, actual.coordinatorPid); assert.equal(record.enginePid, actual.enginePid);
}
const executorSummary = json(join(executor, 'EXECUTOR_SUMMARY.json'));
assert.equal(executorSummary.completedRecords, rows.length); assert.deepEqual(executorSummary.integrityErrors, []);
assert.equal(executorSummary.lifecycleFailureRecords, cleanup.filter(row => !row.lifecycle).length);
for (const [filename, previous] of visited) assert.deepEqual(stableMetadata(lstatSync(filename)), previous, filename);
assert.equal(hash(read(join(freeze, 'proposed-root-receipt.json'))), receiptPin);
assert.equal(hash(read(join(freeze, 'execution-binding.json'))), bindingPin);
const tableSummaries = {};
for (const profile of ['original', 'aligned', 'breadth']) {
  const selected = rows.filter(row => row.profile === profile);
  tableSummaries[profile] = Object.fromEntries(['virtual-bash', 'just-bash'].map(engine => {
    const engineRows = selected.filter(row => row.engine === engine);
    return [engine, profile === 'breadth' ? Object.fromEntries(['targets', 'controls', 'diagnostics'].map(partition => {
      const partitionRows = engineRows.filter(row => row.partition === partition);
      return [partition, { denominator: partitionRows.length, predicateMatches: partitionRows.filter(row => row.predicateMatched).length, operationalCredit: partitionRows.filter(row => row.operationalCredit).length, lifecycleFailures: partitionRows.filter(row => !row.lifecycle).length, classifications: count(partitionRows.map(row => row.status)) }];
    })) : { denominator: engineRows.length, predicateMatches: engineRows.filter(row => row.predicateMatched).length, lifecycleSuccesses: engineRows.filter(row => row.lifecycle).length, acceptedMatches: engineRows.filter(row => row.status === 'pass').length, classifications: count(engineRows.map(row => row.status)) }];
  }));
  const bothFailed = [...new Set(selected.map(row => row.id))].filter(id => selected.filter(row => row.id === id).every(row => profile === 'breadth' ? row.partition !== 'diagnostics' && !row.operationalCredit : row.status !== 'pass'));
  save(`${profile}-table`, { profile, summary: tableSummaries[profile], bothFailedNotParity: bothFailed, rows: selected });
}
const failureRows = rows.filter(row => row.profile === 'breadth' ? row.partition !== 'diagnostics' && !row.operationalCredit : row.status !== 'pass');
save('failure-groups', { groups: Object.fromEntries([...new Set(failureRows.map(row => `${row.profile}/${row.engine}/${row.status}`))].sort().map(key => [key, failureRows.filter(row => `${row.profile}/${row.engine}/${row.status}` === key).map(row => ({ id: row.id, evidence: row.evidence, failedFields: row.failedFields, failedChecks: row.failedChecks, lifecycleFailures: row.lifecycleFailures }))])), records: failureRows });
save('cleanup', { driver: { pid: runReceipt.commandProcessPid, wrapperPid: runReceipt.wrapperPid, exit: completion.exit, close: completion.close, closedAt: completion.closedAt, allAbsent: true }, managedGroups: cleanup.length, distinctManagedPids: new Set(cleanup.flatMap(row => [row.coordinatorPid, row.enginePid])).size, unresolved: [], networkFixtures: networks, attempts: cleanup });
save('imports', { publicImports: Object.fromEntries(publicImports), loaderRecords: [...imported].map(([record, observations]) => ({ ...JSON.parse(record), observations })), qualification: 'Root import fulfilled in every attempt; hash-bound loader returns only, not all-module/worker/CJS evaluation proof.' });
const receiptOutput = { status: 'RAW_INTEGRITY_AND_PREDICATES_VERIFIED_FINAL_INTERPRETATION_REQUIRED', candidate, gitTree: binding.candidate.gitTree, movingCheckoutAtReview: git('rev-parse', 'HEAD').toString().trim(), bindingSha256: bindingPin, announcedReceiptSha256: receiptPin, sourceSha256: binding.candidate.sourceSha256, candidatePackSha256: binding.candidate.packSha256, rawRoot: raw, rawFiles: manifest.files.length, rawBytes: manifest.files.reduce((sum, record) => sum + record.bytes, 0), rawManifestSha256: artifactHashes[join(executor, 'RAW_MANIFEST.json')].sha256, observations: rows.length, missing: 0, duplicate: 0, notRun: 0, reconstructedWireStreamsVerified: wireCounts.length, reconstructedWireBytes: wireCounts.reduce((sum, value) => sum + value, 0), tableSummaries, lifecycleFailures: cleanup.filter(row => !row.lifecycle).map(row => ({ evidence: row.evidence, id: row.id, engine: row.engine, profile: row.profile, failures: row.failures, signals: row.signals })), networkFixtureCount: networks.length, originalNativeOracleInvalid: rows.filter(row => row.oracleValid === false).length, productImportsByReviewer: 0, productExecutionsByReviewer: 0, nativeOracleCallsByReviewer: 0, reviewedReadBytes: readBytes, artifactHashes };
save('receipt', receiptOutput);
console.log(JSON.stringify({ status: receiptOutput.status, rawFiles: receiptOutput.rawFiles, rawBytes: receiptOutput.rawBytes, observations: rows.length, tableSummaries, lifecycleFailures: receiptOutput.lifecycleFailures, networkFixtureCount: networks.length }, null, 2));

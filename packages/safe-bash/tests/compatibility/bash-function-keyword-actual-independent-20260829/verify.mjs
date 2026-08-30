import * as fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export async function verify(context) {
  const { owned, inputs, manifest, stop, matrix, rows, read, json, bounded, hash, result, authenticated, log } = context;
  const deadline = Date.parse('2026-08-29T15:26:13Z');
  assert(Date.now() + 120000 < deadline, 'publication reserve');
  const save = (name, value) => {
    const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n');
    assert(bytes.length < 8 * 1048576);
    fs.writeFileSync(owned + '/' + name, bytes, { flag: 'wx' });
    return hash(bytes);
  };
  const same = (actual, expected) => {
    if (actual === null || expected === null || typeof actual !== 'object' || typeof expected !== 'object') {
      assert(Object.is(actual, expected), 'primitive type/value');
      return;
    }
    assert.equal(Array.isArray(actual), Array.isArray(expected), 'array shape');
    const actualKeys = Reflect.ownKeys(actual), expectedKeys = Reflect.ownKeys(expected);
    assert.equal(actualKeys.length, expectedKeys.length, 'own key count');
    if (Array.isArray(actual)) {
      const length = Object.getOwnPropertyDescriptor(actual, 'length');
      assert(length && Object.hasOwn(length, 'value') && Number.isSafeInteger(length.value));
      assert.equal(actualKeys.length, length.value + 1, 'dense array');
    }
    for (let index = 0; index < actualKeys.length; index++) {
      const key = actualKeys[index];
      assert.equal(typeof key, 'string', 'no symbol keys');
      assert.equal(key, expectedKeys[index], 'exact ordered keys');
      const actualDescriptor = Object.getOwnPropertyDescriptor(actual, key), expectedDescriptor = Object.getOwnPropertyDescriptor(expected, key);
      for (const descriptor of [actualDescriptor, expectedDescriptor]) assert(descriptor && Object.hasOwn(descriptor, 'value') && !Object.hasOwn(descriptor, 'get') && !Object.hasOwn(descriptor, 'set'), 'own data only');
      for (const flag of ['enumerable', 'configurable', 'writable']) assert.equal(actualDescriptor[flag], expectedDescriptor[flag], 'descriptor flag');
      same(actualDescriptor.value, expectedDescriptor.value);
    }
  };
  const binding = (bytes, row) => { assert.equal(bytes.length, row.bytes); assert.equal(hash(bytes), row.sha256); };
  const decode = value => {
    assert(Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= 16 * 1048576);
    assert(typeof value.base64 === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(value.base64));
    const bytes = Buffer.from(value.base64, 'base64');
    assert.equal(bytes.toString('base64'), value.base64, 'canonical base64');
    binding(bytes, value);
    return bytes;
  };
  const frames = (bytes, count) => {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    assert(text.endsWith('\n'), 'final newline');
    const lines = text.slice(0, -1).split('\n');
    if (count !== undefined) assert.equal(lines.length, count, 'frame count');
    assert(lines.every(line => line.length > 0), 'empty frame');
    return lines.map(line => JSON.parse(line));
  };
  const identity = (frame, role) => { assert.equal(frame.caseId, role.caseId); assert.equal(frame.layout, role.layout); assert.equal(frame.profile, role.profile); };
  const traceIdentity = (trace, role) => {
    assert(trace.length >= 2);
    assert.equal(trace[0].event, 'permission-admitted');
    assert.equal(trace[0].child, false);
    assert.equal(trace[0].worker, false);
    assert.equal(trace[0].loaderThreads, 0);
    assert.equal(trace[1].event, 'synchronous-hooks-installed');
    for (const entry of trace) {
      assert.equal(entry.role, role.id, 'trace call ID');
      assert.equal(entry.profile, role.profile);
      if (entry.event === 'module-loaded') {
        const expected = role.files[fileURLToPath(entry.url)];
        assert(expected, 'module outside role binding');
        assert.equal(entry.bytes, expected.bytes);
        assert.equal(entry.sha256, expected.sha256);
      }
    }
  };
  const entries = [...rows.keys()];
  const documents = entries.filter(name => name.endsWith('.json')).map(name => ({ name, value: json(name) }));
  const lifecycleById = new Map();
  for (const document of documents) {
    const value = document.value;
    if (value && !Array.isArray(value) && typeof value.id === 'string' && Array.isArray(value.events) && Array.isArray(value.captures)) {
      assert(!lifecycleById.has(value.id));
      lifecycleById.set(value.id, document);
    }
  }
  const rolesById = new Map(documents.filter(row => row.value?.kind === 'product-case').map(row => [row.value.id, row]));
  const receiptById = new Map(documents.filter(row => row.value?.receipt && row.value?.rolePin && row.value?.trace).map(row => [row.value.id, row]));
  const lifecycle = value => {
    for (const key of ['exit', 'close', 'stdoutEOF', 'stderrEOF', 'capturesQualified', 'qualified']) assert.equal(value[key], true, value.id + ':' + key);
    assert.equal(value.knownOutstanding, 0);
    assert.equal(value.forced, false);
    assert.equal(value.signal, null);
    assert.equal(value.primaryPresent, false);
    assert.equal(value.secondary.length, 0);
    assert.equal(value.signals.length, 0);
    const names = value.events.map(event => event.name);
    for (const name of ['capture-open', 'listeners-enrolled', 'spawn', 'stdout-end', 'stderr-end', 'exit', 'close']) assert.equal(names.filter(entry => entry === name).length, 1);
    assert(names.indexOf('capture-open') < names.indexOf('spawn'));
    assert(names.indexOf('listeners-enrolled') < names.indexOf('spawn'));
    for (const name of ['exit', 'stdout-end', 'stderr-end']) assert(names.indexOf(name) < names.indexOf('close'));
    assert.equal(value.captures.length, 2);
    const captures = {};
    for (const capture of value.captures) {
      assert(['stdout', 'stderr'].includes(capture.kind) && !captures[capture.kind]);
      assert.equal(capture.flushed, true);
      assert.equal(capture.closed, true);
      const bytes = decode(capture);
      const matches = entries.filter(name => name.endsWith('.' + capture.kind) && path.basename(name, '.' + capture.kind) === value.id);
      if (matches.length === 1) assert(read(matches[0]).equals(bytes));
      captures[capture.kind] = { bytes: capture.bytes, sha256: capture.sha256, rawPath: matches.length === 1 ? path.join(manifest.root, matches[0]) : null };
    }
    return { id: value.id, pid: value.pid, status: value.status, signal: value.signal, qualified: true, captures };
  };
  assert.equal(result.source, '52b6711e888361015acc38017be2a6b08509d8a7');
  assert.equal(result.source, stop.source);
  assert.equal(result.observations.length, 54);
  assert.equal(result.ledger.rows.length, 63);
  assert.equal(result.ledger.active, 0);
  const directChildren = result.ledger.rows.map(row => {
    const retained = lifecycleById.get(row.id);
    assert(retained, 'missing lifecycle from inventory');
    same(row, retained.value);
    return { ...lifecycle(row), evidencePath: path.join(manifest.root, retained.name) };
  });
  assert.equal(new Set(directChildren.map(row => row.id)).size, 63);
  assert.equal(new Set(directChildren.map(row => row.pid)).size, 63);
  const primary = [], pairs = [], failures = [];
  let mutantCalls = 0;
  const cases = [...result.observations, ...result.mutants.map(row => row.receipt)];
  for (const entry of cases) {
    const retained = receiptById.get(entry.id), roleDocument = rolesById.get(entry.id);
    assert(retained && roleDocument, 'case evidence absent from manifest');
    same(entry, retained.value);
    const role = roleDocument.value;
    binding(read(roleDocument.name), entry.rolePin);
    assert.equal(role.id, entry.id);
    const life = lifecycleById.get(entry.id).value;
    const stdout = decode(life.captures.find(row => row.kind === 'stdout'));
    const frame = frames(stdout, 1)[0];
    identity(frame, role);
    same(frame, entry.receipt);
    const traceBytes = read(role.trace);
    binding(traceBytes, entry.trace);
    const trace = frames(traceBytes);
    same(trace, entry.trace.rows);
    traceIdentity(trace, role);
    for (const observation of frame.observations) {
      assert.equal(observation.kind, 'resolved');
      assert(Number.isSafeInteger(observation.status));
      decode(observation.stdout); decode(observation.stderr);
      assert.equal(observation.hasPrimary, false);
      assert.equal(observation.hasCleanupError, false);
      same(observation.cleanup, { attempted: true, settled: true, rejected: false });
      assert.equal(observation.publicSettlement.privateOutstandingJobs, 'NOT_OBSERVED');
    }
    const summary = { id: entry.id, caseId: frame.caseId, layout: frame.layout, pass: frame.pass, assertionFailures: frame.failures, childStatus: life.status, observationStatuses: frame.observations.map(row => row.status), observationCalls: frame.observations.length, receiptPath: path.join(manifest.root, retained.name), rolePath: path.join(manifest.root, roleDocument.name), stdoutPath: directChildren.find(row => row.id === entry.id).captures.stdout.rawPath, tracePath: role.trace };
    if (result.observations.some(row => row.id === entry.id)) {
      primary.push(summary);
      if (frame.observations.length === 2) { same(frame.observations[0], frame.observations[1]); pairs.push({ id: entry.id, completeOwnDataEqual: true }); }
      else assert.equal(frame.observations.length, 1);
      if (!frame.pass) {
        assert.equal(frame.caseId, 'K08');
        for (const observation of frame.observations) {
          assert.equal(observation.status, 1);
          assert.equal(decode(observation.stdout).length, 0);
          const reason = decode(observation.stderr);
          assert.equal(reason.length, 87);
          assert.equal(reason.toString(), 'shell: line 1: $1 - 1: arithmetic syntax error in expression (error token is "$1 - 1")\n');
        }
        failures.push({ ...summary, stdout: frame.observations[0].stdout, stderr: frame.observations[0].stderr, stderrUtf8: decode(frame.observations[0].stderr).toString() });
      }
    } else mutantCalls += frame.observations.length;
  }
  assert.equal(primary.filter(row => row.pass).length, 51);
  assert.equal(failures.length, 3);
  assert.equal(pairs.length, 24);
  const layouts = ['source-built', 'installed', 'physically-moved'].map(name => {
    const selected = primary.filter(row => row.layout === name);
    assert.equal(selected.length, 18);
    assert.equal(selected.filter(row => row.pass).length, 17);
    assert.equal(new Set(selected.map(row => row.caseId)).size, 18);
    return { name, primary: 18, pass: 17, fail: 1, legacyPairs: pairs.filter(row => selected.some(entry => entry.id === row.id)).length };
  });
  assert.equal(result.mutants.length, 3);
  for (const mutant of result.mutants) { assert.equal(mutant.detected, true); assert.notEqual(mutant.before, mutant.after); assert.equal(mutant.receipt.receipt.pass, false); }
  assert.equal(mutantCalls, 5);
  const refusals = result.refusals.map(refusal => {
    assert.equal(refusal.refused, true);
    assert.equal(refusal.lifecycle.status, 1);
    same(refusal.lifecycle, lifecycleById.get(refusal.id).value);
    const stderr = decode(refusal.lifecycle.captures.find(row => row.kind === 'stderr'));
    assert(stderr.toString().includes(refusal.expectedRefusal));
    const tracePath = entries.find(name => name.endsWith('.trace') && path.basename(name, '.trace') === refusal.id);
    assert(tracePath);
    assert.equal(hash(read(tracePath)), refusal.traceSha256);
    return { id: refusal.id, expectedRefusal: refusal.expectedRefusal, status: 1, lifecyclePath: path.join(manifest.root, lifecycleById.get(refusal.id).name), tracePath: path.join(manifest.root, tracePath), stderrBytes: stderr.length, stderrSha256: hash(stderr) };
  });
  assert.equal(refusals.length, 2);
  const proofs = directChildren.filter(row => row.id === 'build' || result.types.some(entry => entry.lifecycle.id === row.id));
  assert.equal(proofs.length, 4);
  for (const proof of proofs) assert.equal(proof.status, 0);
  const commandFields = [];
  const scan = (value, location, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 20) return;
    for (const [key, nested] of Object.entries(value)) {
      if (['cmd', 'command', 'argv', 'args', 'executable'].includes(key)) commandFields.push({ location: location + '.' + key, value: nested });
      if (key !== 'files' && key !== 'edges') scan(nested, location + '.' + key, depth + 1);
    }
  };
  for (const proof of proofs) scan(lifecycleById.get(proof.id).value, proof.evidencePath);
  const collectorPath = stop.rawReceipts.find(row => path.basename(row.path) === 'COLLECTOR.json').path;
  const collector = json(collectorPath);
  lifecycle(collector.ownerLifecycle);
  assert.equal(collector.ledger.active, 0);
  const ownerFrame = frames(read(entries.find(name => name === 'owner.stdout')), 1)[0];
  assert.equal(ownerFrame.finalization.publicationSucceeded, true);
  const ownerFinalPath = stop.rawReceipts.find(row => path.basename(row.path) === 'OWNER-FINALIZATION.json').path;
  assert.equal(json(ownerFinalPath).state.publicationSucceeded, false);
  const adminPath = '/private/tmp/safe-bash-b35-v4-PLN3cC/future/publication-admin/LEDGER.json';
  const adminRaw = bounded(adminPath, 1048576), admin = JSON.parse(adminRaw);
  assert.equal(admin.starts.length, 6);
  const administration = admin.starts.map(row => {
    same(row.exit, { code: 0, signal: null }); same(row.close, { code: 0, signal: null });
    for (const channel of [row.stdout, row.stderr]) binding(bounded(channel.path, 1048576), channel);
    return { index: row.index, cmd: row.cmd, args: row.args, exit: row.exit, close: row.close, stdout: row.stdout, stderr: row.stderr };
  });
  assert.equal(admin.runtimeKnownStarts, 65);
  const packageBytes = bounded(stop.retainedPackage.path, 2097152);
  binding(packageBytes, stop.retainedPackage);
  const presealPath = 'tests/compatibility/bash-function-keyword-author-20260829/preexec-v4/PRESEAL.json';
  const presealBytes = bounded(presealPath, 4 * 1048576);
  assert.equal(hash(presealBytes), stop.presealSha256);
  const historicalPackage = '275a6c1006a5986d9d878a2344b95158fc320187a07a1d7f25584c10d7e7959d';
  assert(presealBytes.toString().includes(historicalPackage));
  assert.notEqual(stop.retainedPackage.sha256, historicalPackage);
  assert.equal(result.shipping.length, 1002);
  const tests = [];
  const test = (id, body) => { try { body(); tests.push({ id, status: 'PASS' }); } catch (reason) { tests.push({ id, status: 'FAIL', reason: String(reason) }); } };
  const sample = result.observations[0], role = rolesById.get(sample.id).value;
  const sampleBytes = decode(lifecycleById.get(sample.id).value.captures.find(row => row.kind === 'stdout'));
  test('F01-truncated-extra-and-invalid-UTF8-frames-refused', () => {
    assert.throws(() => frames(sampleBytes.subarray(0, -1), 1));
    assert.throws(() => frames(Buffer.concat([sampleBytes, sampleBytes]), 1));
    assert.throws(() => frames(Buffer.from([255, 10]), 1));
  });
  test('F02-spliced-case-layout-identity-refused', () => {
    const frame = frames(sampleBytes, 1)[0];
    assert.throws(() => identity({ ...frame, caseId: 'K99' }, role));
    assert.throws(() => identity({ ...frame, layout: 'foreign-layout' }, role));
  });
  test('F03-trace-call-ID-tamper-refused', () => { const trace = frames(read(role.trace)); trace[0].role = 'foreign-call'; assert.throws(() => traceIdentity(trace, role)); });
  test('T04-length-and-hash-tamper-refused', () => { const altered = Buffer.from(sampleBytes); altered[0] ^= 1; const expected = { bytes: sampleBytes.length, sha256: hash(sampleBytes) }; assert.throws(() => binding(altered, expected)); assert.throws(() => binding(sampleBytes.subarray(1), expected)); });
  test('T05-byte-envelope-tamper-refused', () => { const expected = sample.receipt.observations[0].stdout; assert.throws(() => decode({ ...expected, bytes: expected.bytes + 1 })); assert.throws(() => decode({ ...expected, base64: expected.base64 + '!' })); });
  test('T06-cross-realm-own-data-not-prototypes', () => {
    same(vm.runInNewContext('({status:1, values:[false,0]})'), { status: 1, values: [false, 0] });
    const remote = vm.runInNewContext('({status:1, values:[false,0], extra:true})');
    assert.throws(() => same(remote, { status: 1, values: [false, 0] }));
    const accessor = vm.runInNewContext('({get status(){throw new Error("getter invoked")}, values:[false,0]})');
    assert.throws(() => same(accessor, { status: 1, values: [false, 0] }), /own data only/);
    assert.throws(() => same(vm.runInNewContext('[,0]'), [undefined, 0]));
    assert.throws(() => same(vm.runInNewContext('[false,"0"]'), [false, 0]));
  });
  assert.equal(tests.filter(row => row.status === 'PASS').length, 6);
  for (const row of manifest.rows) binding(read(row.path), row);
  for (const row of inputs.inputs) assert.equal(hash(bounded(inputs.author + '/' + row.name)), row.sha256);
  const observationReport = { phase: 'FINITE_RETAINED_DATA_ONLY', source: result.source, layouts, primary, primaryPass: 51, primaryFail: 3, failures, legacyPairs: pairs, mutantCalls, mutants: result.mutants.map(row => ({ id: row.mutation.id, detected: row.detected, receiptPath: path.join(manifest.root, receiptById.get(row.receipt.id).name) })), refusals, directChildren, proofReceipts: proofs, proofCommandFields: commandFields, proofCommandQualification: commandFields.length ? 'Only actual retained fields listed; no reconstruction' : 'Build/typecheck lifecycle receipts retain no executable/argv; exact proof commands and strict flags are NOT independently authenticated by this manifest', collectorPath, collectorOwnerPid: collector.ownerLifecycle.pid, collectorToolExit: stop.dispatch.toolResult, runtimeKnownClosed: 65, administrativeKnownClosed: 6, totalKnownClosed: 71, retirementQualification: '63 direct subordinate lifecycle records + owner under collector + reported collector tool exit; administrative ledger is later live retained evidence outside the sealed 375-file manifest, hashed here; no universal descendant/OS containment/private-job/RSS proof', adminPath, adminSha256: hash(adminRaw), administration, package: { path: stop.retainedPackage.path, bytes: packageBytes.length, sha256: hash(packageBytes), inflated: false, historicalSha256: historicalPackage, historicalIdentitySource: presealPath, presealSha256: hash(presealBytes), shippingRows: 1002, shippingQualification: 'authenticated retained inventory only; no new package inflation' }, publication: stop.publicationPrimary, tests };
  const findingsSha256 = save('FINDINGS.json', observationReport);
  const files = fs.readdirSync(owned).sort().map(name => ({ name, bytes: fs.lstatSync(owned + '/' + name).size, sha256: hash(bounded(owned + '/' + name)) }));
  const logicalBytes = files.reduce((sum, row) => sum + row.bytes, 0);
  assert(logicalBytes + 1048576 < 256 * 1048576);
  const receipt = { at: new Date().toISOString(), started: '2026-08-29T15:11:13Z', publicationDeadline: new Date(deadline).toISOString(), authorCommit: '47a2311e592666b9851e734120570e0ba9be6561', stopSha256: 'cb024e8206bac5a540fff7bd03a1f30e1e6b3fa79ca5cda3c8bfbc87e32c82cb', findingsSha256, authenticatedFiles: 375, authenticatedBytes: 24291650, primaryPass: 51, primaryFail: 3, completeLegacyPairsEqual: 24, mutantsDetected: 3, mutantCalls: 5, bindingRefusals: 2, buildExitZero: 1, typecheckExitZero: 3, strictCommandQualification: observationReport.proofCommandQualification, knownClosed: 71, controls: { pass: 6, fail: 0 }, helperInvocations: 2, actualProduct: false, archiveInflated: false, archiveRepacked: false, verdict: 'FINITE DATA ACCEPT; CAMPAIGN PUBLICATION HOLD; strict proof argv absent from retained lifecycle data', sourceFixTransfer: false, filesBeforeReceiptAndPublication: files, logicalBytesBeforeReceiptAndPublication: logicalBytes, publicationReserveBytes: 1048576, priorFailuresPreserved: true };
  const receiptSha256 = save('RECEIPT.json', receipt);
  log({ phase: 'verified', receiptSha256, files: 375, bytes: 24291650, primaryPass: 51, primaryFail: 3, pairs: 24, mutants: 3, mutantCalls, refusals, proofs, proofCommandFields: commandFields, controls: tests, knownClosed: 71, logicalBytes, at: receipt.at });
}

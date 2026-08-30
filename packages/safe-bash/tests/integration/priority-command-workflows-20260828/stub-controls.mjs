import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { sha, readJson, writeJson, inventory, directory, repository, packet, composition, admitFile, expectedGrant, requireGrant, validateRetirement } from './admission.mjs';
import { authenticateArchive, storedRequests, verifyStoredBatch } from './source-auth.mjs';
import { observeWorkers } from './worker-observer.mjs';

assert.deepEqual(process.argv.slice(2), ['--out', path.join(directory, 'stub-evidence-v2')]);
const protocol = readJson(path.join(directory, 'STUB-PROTOCOL-v2.json'));
for (const row of protocol.files) assert.equal(sha(fs.readFileSync(path.join(directory, row.path))), row.sha256, row.path);
const output = process.argv[3]; assert.equal(fs.existsSync(output), false); fs.mkdirSync(output);
const started = Date.now();
const evidence = { role: 'DATA_SYNTHETIC_BENIGN_STUB_ONLY', protocolSha256: sha(fs.readFileSync(path.join(directory, 'STUB-PROTOCOL-v2.json'))), started, host: { node: process.execPath, version: process.version, qualification: 'stub host only; not accepted-tool qualification' }, synthetic: [], children: [], failures: [], productImports: 0, productExecutions: 0, nativeOracleExecutions: 0 };
const test = (name, body) => { try { body(); evidence.synthetic.push({ name, pass: true }); } catch (error) { evidence.synthetic.push({ name, pass: false, error: String(error) }); evidence.failures.push({ name, error: String(error) }); } };
function child(label, executable, args, input, timeout = 5000) {
  assert.ok(evidence.children.length < protocol.bounds.children && Date.now() - started < protocol.bounds.windowMs);
  const result = spawnSync(executable, args, { cwd: repository, env: { PATH: '/usr/bin:/bin', HOME: output, TMPDIR: output }, input, timeout, killSignal: 'SIGKILL', maxBuffer: label === 'stored-object-data' ? 33554432 : 1048576 });
  const row = { label, executable, args, pid: result.pid, status: result.status, signal: result.signal, error: result.error?.message, reaped: result.status !== null || result.signal !== null, stdoutBase64: label === 'stored-object-data' ? undefined : result.stdout.toString('base64'), stdoutSha256: sha(result.stdout), stderrBase64: result.stderr.toString('base64') };
  evidence.children.push(row); writeJson(path.join(output, label + '.child.json'), row);
  assert.equal(result.signal, null); assert.equal(result.error, undefined); assert.equal(row.reaped, true);
  return result;
}
try {
  for (const row of protocol.files.filter(row => row.path.endsWith('.mjs'))) test('parse-only:' + row.path, () => { new vm.SourceTextModule(fs.readFileSync(path.join(directory, row.path), 'utf8'), { identifier: row.path }); });
  const { raw, bindings } = authenticateArchive();
  const requests = storedRequests(raw, bindings);
  const result = child('stored-object-data', '/usr/bin/git', ['cat-file', '--batch'], requests.map(row => row.expression).join('\n') + '\n', 20000);
  assert.equal(result.status, 0);
  const verified = verifyStoredBatch(requests, result.stdout);
  writeJson(path.join(output, 'SOURCE-AUTH.json'), { role: 'PREPARATION_DATA_STORED_OBJECT_VERIFICATION', packet, composition, pass: true, archiveSha256: bindings.archive.sha256, selectedInputTableSha256: bindings.selected.selectedInputTableSha256, derivedOnlyTreeRecomputed: true, freshFutureGitExistenceClaim: false, rows: verified });
  await import('./verify.mjs');
  evidence.originalMalformedDataControls = 8;
  const stub = path.join(directory, 'stub-entry.mjs');
  const files = { [stub]: { sha256: sha(fs.readFileSync(stub)), role: 'stub', relative: 'stub-entry.mjs' } };
  test('missing-entry', () => assert.throws(() => admitFile(pathToFileURL(stub).href, {}), /OUTSIDE_ADMISSION/u));
  test('wrong-digest', () => assert.throws(() => admitFile(pathToFileURL(stub).href, { [stub]: { ...files[stub], sha256: '0'.repeat(64) } }), /LOAD_HASH_REFUSED/u));
  test('outside-file', () => assert.throws(() => admitFile(pathToFileURL(path.join(output, 'outside.mjs')).href, files), /OUTSIDE_ADMISSION/u));
  test('sourcefallback', () => assert.throws(() => admitFile(pathToFileURL(path.join(output, 'source.ts')).href, files), /SOURCE_FALLBACK_REFUSED/u));
  const sealBytes = Buffer.from('benign-synthetic-seal');
  const grant = expectedGrant(sha(sealBytes));
  test('missing-go', () => assert.throws(() => requireGrant(undefined, sealBytes), /EXACT_ROOT_COMMAND_GRANT_REQUIRED/u));
  for (const key of ['decision', 'packet', 'root', 'composition', 'preparationSealSha256']) test('grant-drift:' + key, () => { const changed = structuredClone(grant); changed[key] += '-wrong'; assert.throws(() => requireGrant(changed, sealBytes), /EXACT_ROOT_COMMAND_GRANT_REQUIRED/u); });
  test('grant-command-drift', () => { const changed = structuredClone(grant); changed.command.push('--fallback'); assert.throws(() => requireGrant(changed, sealBytes), /EXACT_ROOT_COMMAND_GRANT_REQUIRED/u); });
  test('grant-app-parent-drift', () => { const changed = structuredClone(grant); changed.layouts[2].appParent += '-wrong'; assert.throws(() => requireGrant(changed, sealBytes), /EXACT_ROOT_COMMAND_GRANT_REQUIRED/u); });
  const retired = { exited: true, exitCode: 0, terminatePending: 0, terminateErrors: [], emergency: false };
  test('synthetic-unreaped-stop', () => assert.throws(() => validateRetirement([{ ...retired, exited: false }]), /WORKER_UNREAPED_STOP/u));
  test('synthetic-terminate-pending-stop', () => assert.throws(() => validateRetirement([{ ...retired, terminatePending: 1 }]), /TERMINATE_UNSETTLED_STOP/u));
  test('synthetic-terminate-error-stop', () => assert.throws(() => validateRetirement([{ ...retired, terminateErrors: ['benign-stub-error'] }]), /TERMINATE_ERROR_STOP/u));
  test('synthetic-unknown-exit-stop', () => assert.throws(() => validateRetirement([{ ...retired, exitCode: null }]), /UNKNOWN_EXIT_STOP/u));
  test('synthetic-emergency-stop', () => assert.throws(() => validateRetirement([{ ...retired, emergency: true }]), /EMERGENCY_RETIREMENT_STOP/u));
  const guard = path.join(directory, 'stub-guard.mjs'), preload = path.join(directory, 'worker-preload.mjs');
  const observerFiles = { ...files, [guard]: { sha256: sha(fs.readFileSync(guard)) }, [preload]: { sha256: sha(fs.readFileSync(preload)) } };
  const observer = observeWorkers({ files: observerFiles, entry: pathToFileURL(stub).href, preload: pathToFileURL(preload).href, guard: pathToFileURL(guard).href, parentLog: path.join(output, 'no-start.jsonl'), maxStarts: 0, maxConcurrent: 0, captureBytes: 4096, cleanupMs: 100 });
  const { Worker } = await import('node:worker_threads');
  const options = { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } };
  test('worker-url-drift-before-start', () => assert.throws(() => new Worker(new URL('./stub-dependency.mjs', import.meta.url), options), /WORKER_URL_DRIFT/u));
  test('worker-options-drift-before-start', () => assert.throws(() => new Worker(new URL('./stub-entry.mjs', import.meta.url), { ...options, execArgv: ['--inspect'] }), /WORKER_OPTIONS_DRIFT/u));
  test('worker-preload-digest-drift-before-start', () => { const changed = { ...observerFiles, [preload]: { sha256: '0'.repeat(64) } }; assert.throws(() => observeWorkers({ files: changed, preload: pathToFileURL(preload).href, guard: pathToFileURL(guard).href }), /LOAD_HASH_REFUSED/u); });
  await observer.close(); assert.equal(observer.rows.length, 0); assert.equal(observer.admissionRefusals.length, 2);
  const refusal = child('no-go-no-setup', process.execPath, [path.join(directory, 'future-supervisor.mjs')]);
  assert.notEqual(refusal.status, 0); assert.ok(refusal.stderr.toString().includes('EXACT_COMMAND_REQUIRED_NO_SETUP'));
  assert.equal(fs.existsSync(path.join(directory, 'future-run-01')), false);
  for (const mode of protocol.stubModes) {
    const result = child(mode, process.execPath, [path.join(directory, 'stub-child.mjs'), mode, output]);
    const record = JSON.parse(result.stdout.toString());
    const loadPath = path.join(output, mode + '.worker.jsonl');
    const loads = fs.existsSync(loadPath) ? fs.readFileSync(loadPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    test('actual-stub:' + mode, () => {
      assert.equal(result.status, 0); assert.equal(record.pass, true);
      assert.equal(record.admissionRefusals.length, ['late-acquisition', 'concurrent-bound', 'cumulative-bound'].includes(mode) ? 1 : 0);
      for (const row of record.rows) {
        assert.equal(row.exited, true); assert.equal(row.terminatePending, 0);
        const matching = loads.filter(load => load.token === row.token && load.threadId === row.threadId);
        assert.ok(matching.some(load => load.event === 'preload'));
        assert.ok(matching.some(load => load.event === 'load' && load.url === pathToFileURL(stub).href && load.sha256 === files[stub].sha256));
        if (mode !== 'loader-drift') assert.ok(matching.some(load => load.event === 'load' && load.relative === 'stub-dependency.mjs'));
        else assert.equal(matching.some(load => load.event === 'load' && load.relative === 'stub-dependency.mjs'), false);
      }
      assert.equal(loads.some(load => load.role === 'product'), false);
    });
    evidence.children.at(-1).observation = record;
  }
} catch (error) { evidence.failures.push({ kind: 'driver', message: String(error), stack: error?.stack }); }
finally {
  evidence.finished = Date.now(); evidence.allOwnedOsChildrenReaped = evidence.children.every(row => row.reaped);
  evidence.workerStarts = evidence.children.reduce((sum, row) => sum + (row.observation?.rows.length ?? 0), 0);
  evidence.retainedBytesBeforeFinalReceipt = Object.values(inventory(output)).reduce((sum, row) => sum + (row.bytes ?? 0), 0);
  if (evidence.workerStarts > protocol.bounds.workerStarts || evidence.finished - started > protocol.bounds.windowMs || evidence.retainedBytesBeforeFinalReceipt + Buffer.byteLength(JSON.stringify(evidence, null, 2)) > protocol.bounds.storageBytes) evidence.failures.push({ kind: 'RESOURCE_BOUND' });
  evidence.allOwnedWorkersReaped = evidence.children.every(row => row.observation?.rows.every(worker => worker.exited && worker.terminatePending === 0) ?? true);
  evidence.pass = evidence.failures.length === 0 && evidence.allOwnedOsChildrenReaped && evidence.allOwnedWorkersReaped;
  writeJson(path.join(output, 'RESULTS.json'), evidence);
  console.log(JSON.stringify({ role: evidence.role, pass: evidence.pass, syntheticChecks: evidence.synthetic.length, failures: evidence.failures, children: evidence.children.length, workerStarts: evidence.workerStarts, productExecutions: 0 }));
  if (!evidence.pass) process.exitCode = 1;
}

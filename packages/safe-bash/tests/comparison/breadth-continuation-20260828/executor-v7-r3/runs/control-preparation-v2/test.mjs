import { createEvidenceBudget } from '../../evidence.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { authenticatePacket } from '../../authorization.mjs';
import { createStore, readDocument } from '../../records.mjs';
import { createLedger, launchTracked } from '../../launch-ledger.mjs';
import { supervise } from '../../supervisor.mjs';
import { transport } from '../../transport.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'runs/ordering-stubs-v2-01');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const preparationBytes = fs.readFileSync(path.join(output, 'PREPARATION.json'));
assert.equal(hash(preparationBytes), process.argv[2]);
const preparation = JSON.parse(preparationBytes);
assert.equal(authenticatePacket(root), preparation.recipeSha256);
const fixtures = readDocument(output, preparation.reference.path, preparation.reference.sha256);
const evidence = path.join(output, 'receipts'); fs.mkdirSync(evidence, { mode: 0o755 });
const store = createStore(evidence, { budget: createEvidenceBudget(evidence, { limit: 67108864 }) }), ledger = createLedger(8), rows = [], metadata = [];
const writer = transport();
let unsafe = false;
function absent(identifier) { try { process.kill(identifier, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } }
function verify(fixture, after = false) {
  assert.equal(authenticatePacket(root), preparation.recipeSha256);
  const expected = new Map(fixture.initial.map(entry => [entry.path, entry]));
  const additions = new Set(after ? [path.relative(fixture.repository, path.join(fixture.output, 'OBSERVER.json')), ...(fixture.specimen.variant === 'bad-grant' ? [] : [path.relative(fixture.repository, path.join(fixture.output, 'operation-probe-3.claim'))])] : []);
  const directories = new Set();
  for (const filename of [...expected.keys(), ...additions]) { let directory = path.dirname(filename); while (directory !== '.') { directories.add(directory); directory = path.dirname(directory); } }
  let seen = 0, bytes = 0;
  function visit(directory) {
    for (const name of fs.readdirSync(directory).sort()) {
      assert.notEqual(name.toUpperCase(), 'AGENTS.MD');
      const filename = path.join(directory, name), info = fs.lstatSync(filename);
      assert.equal(info.isSymbolicLink(), false);
      if (info.isDirectory()) { assert.ok(directories.has(path.relative(fixture.repository, filename)), 'UNLISTED_DIRECTORY'); visit(filename); continue; }
      assert.ok(info.isFile() && info.size <= 262144); bytes += info.size;
      assert.ok(bytes <= 8 * 1024 * 1024);
      const relative = path.relative(fixture.repository, filename), entry = expected.get(relative);
      if (!entry) { assert.ok(additions.delete(relative), `UNLISTED:${relative}`); if (filename.endsWith('.claim')) { assert.equal(hash(fs.readFileSync(filename)), fixture.claimPermit.sha256); assert.equal(info.mode & 0o7777, fixture.claimPermit.mode); } continue; }
      let original = fs.readFileSync(filename);
      if (after && fixture.specimen.variant === 'drift' && filename === fixture.driftPath) {
        const suffix = Buffer.from('\nexport const drift = true;\n');
        assert.ok(original.subarray(-suffix.length).equals(suffix)); original = original.subarray(0, -suffix.length);
      }
      assert.equal(original.length, entry.bytes); assert.equal(hash(original), entry.sha256); assert.equal(info.mode & 0o7777, entry.mode); seen++;
    }
  }
  visit(fixture.repository); assert.equal(seen, expected.size); assert.equal(additions.size, 0);
  return { files: seen, totalPhysicalBytes: bytes, plannedDriftOnly: after && fixture.specimen.variant === 'drift' };
}
function assess(fixture, receipt) {
  const variant = fixture.specimen.variant, rows = receipt.records, final = rows.at(-1), kinds = rows.map(row => row.kind);
  assert.equal(receipt.exit.code, fixture.specimen.exit); assert.equal(receipt.close.code, fixture.specimen.exit);
  assert.equal(final.kind, 'final'); assert.deepEqual(final.late, []);
  const authority = rows.filter(row => row.kind === 'authority-observed');
  assert.equal(authority.length, 2); assert.deepEqual(authority.map(row => row.sequence), [0, 1]);
  assert.deepEqual(final.authorityMetadata, authority.map(row => row.receipt));
  for (const row of authority) { assert.equal(row.receipt.status, 0); assert.equal(row.receipt.signal, null); assert.equal(row.receipt.reaped, true); assert.equal(row.receipt.errorCode, null); }
  const event = kind => rows.findIndex(row => row.kind === kind);
  const loads = rows.filter(row => row.kind === 'nextLoad');
  const observation = JSON.parse(fs.readFileSync(path.join(fixture.output, 'OBSERVER.json')));
  assert.equal(observation.denied.length, 0);
  assert.ok(observation.loaded.some(row => row.path === path.join(fixture.home, 'worker.mjs') && row.sha256 === fixture.bodySha256));
  assert.ok(observation.loaded.some(row => row.path.endsWith('/executor-v3/offline.mjs')));
  assert.ok(observation.loaded.some(row => row.path === path.join(fixture.home, 'authorization.mjs')));
  if (['positive', 'drift', 'guard-evaluation', 'late-filesystem'].includes(variant)) {
    assert.ok(event('worker-operation-authorized') > 1);
    assert.ok(event('bootstrap-authentication-start') > event('worker-operation-authorized'));
    assert.ok(event('bootstrap-authenticated') > event('bootstrap-authentication-start'));
    assert.ok(event('worker-loader-installed') > event('bootstrap-authenticated'));
    assert.ok(event('worker-offline-installed') > event('worker-loader-installed'));
    assert.ok(event('nextLoad') > event('worker-offline-installed'));
  }
  if (['positive', 'guard-evaluation', 'late-filesystem'].includes(variant)) {
    assert.equal(loads.length, 4);
    const queries = rows.filter(row => row.kind === 'bootstrap-unavailable');
    assert.deepEqual(queries.map(row => [row.query, row.slot, row.nativeDelegation]), [['module', 1, false], ['worker_threads', 2, false]]);
    assert.equal(final.report.bootstrap.revoked, true); assert.equal(final.report.bootstrap.nativeDelegations, 0); assert.equal(final.report.bootstrap.consumed, 2);
    assert.equal(final.report.loads.entryResolutions[0].accepted, true); assert.equal(final.report.loads.consumerResolutions[0].accepted, true);
    assert.equal(final.report.resources.pending, 0); assert.equal(final.report.resources.descriptors, 0);
    assert.equal(final.report.postGuard, true); assert.deepEqual(final.cleanupErrors, []);
  }
  if (variant === 'positive') { assert.equal(receipt.natural, true); assert.deepEqual(final.report.resources.violations, []); }
  if (variant === 'reversion') { assert.equal(final.fatal.code, 'OFFLINE_DENIED'); assert.ok(rows.some(row => row.kind === 'offline-denied' && row.operation === 'fs.lstatSync')); assert.equal(loads.length, 0); assert.equal(event('consumer-evaluated'), -1); }
  if (variant === 'drift') { assert.equal(observation.driftApplied, true); assert.equal(final.fatal.code, 'LOAD_METADATA'); assert.ok(rows.some(row => row.kind === 'load-denied' && row.code === 'LOAD_METADATA')); assert.ok(!loads.some(row => row.path.endsWith('/bundle/index.js'))); assert.equal(event('consumer-evaluated'), -1); assert.ok(final.cleanupErrors.some(row => row.phase === 'post-view')); }
  if (['wrong-wrapper', 'wrong-mode', 'bad-grant'].includes(variant)) { assert.equal(final.fatal.code, variant === 'bad-grant' ? 'ROOT_GRANT_SCHEMA' : 'BOOTSTRAP_CONSUMER'); assert.equal(event('worker-offline-installed'), -1); assert.equal(loads.length, 0); assert.equal(event('consumer-evaluated'), -1); assert.deepEqual(final.cleanupErrors, []); }
  if (['guard-evaluation', 'late-filesystem'].includes(variant)) { assert.equal(final.report.resources.violations.length, 1); assert.equal(final.report.resources.violations[0].operation, 'fs.lstatSync'); assert.ok(event('offline-denied') > event('worker-offline-installed')); assert.ok(variant === 'guard-evaluation' ? event('offline-denied') < event('consumer-evaluated') : event('offline-denied') > event('consumer-evaluated')); }
  return { kindOrder: kinds, sourceLoadWitnesses: observation.loaded.length, guardedStubLoads: loads.length, wholeWorker: true, actualOfflineGuard: true, actualAuthorizationValidationWithStubTransport: true, realGitAuthority: false, finalReportPresent: Boolean(final.report), designatedPredicate: fixture.specimen.predicate };
}
for (const fixture of fixtures.cases) {
  if (unsafe) { rows.push({ id: fixture.specimen.id, status: 'UNRUN_UNSAFE_STOP' }); continue; }
  let receipt;
  try {
    const pre = verify(fixture);
    store.save(`${fixture.specimen.id}-PRE.json`, { pre, bodySha256: fixture.bodySha256, recipe: fixture.recipe, adapted: fixture.changed });
    receipt = await launchTracked({ ledger, kind: fixture.specimen.id, prepare: async () => ({ configSha: fixture.configSha256 }), supervise: (_prepared, attach) => supervise(fixture.node, ['--unhandled-rejections=strict', '--max-old-space-size=256', '--import', path.join(root, 'observer.mjs'), path.join(fixture.home, 'worker.mjs'), fixture.configPath, fixture.configSha256], fixture.output, { onSpawn: attach }), persist: async (_entry, value) => store.save(`${fixture.specimen.id}-RAW.json`, value).sha256 });
    assert.equal(receipt.reaped, true); assert.ok(receipt.exit && receipt.close); assert.deepEqual(receipt.failures, []); assert.deepEqual(receipt.signals, []);
    assert.equal(Buffer.from(receipt.stdout, 'base64').length, receipt.captureBytes.stdout); assert.equal(Buffer.from(receipt.stderr, 'base64').length, receipt.captureBytes.stderr); assert.equal(Buffer.from(receipt.rawRecords, 'base64').length, receipt.captureBytes.records);
    const final = receipt.records.at(-1); assert.equal(final?.kind, 'final'); assert.ok(Array.isArray(final.authorityMetadata));
    for (const item of final.authorityMetadata) { metadata.push(item); assert.ok(item.reaped && absent(item.pid) && absent(item.group)); }
    const post = verify(fixture, true);
    let detail;
    try { detail = { id: fixture.specimen.id, status: 'PASS', observed: assess(fixture, receipt), post }; }
    catch (error) { detail = { id: fixture.specimen.id, status: 'FAIL_ASSERTION', error: { name: error.name, message: error.message, code: error.code }, post }; }
    store.save(`${fixture.specimen.id}-RESULT.json`, detail); rows.push(detail);
  } catch (error) {
    unsafe = true;
    const detail = { id: fixture.specimen.id, status: 'UNSAFE_STOP', error: { name: error.name, message: error.message, code: error.code }, receiptPersisted: Boolean(receipt) };
    store.save(`${fixture.specimen.id}-UNSAFE.json`, detail); rows.push(detail);
  }
}
try { await ledger.closeAll(); } catch (error) { unsafe = true; store.save('CLEANUP-FAILURE.json', { message: error.message, code: error.code }); }
assert.equal(authenticatePacket(root), preparation.recipeSha256);
const result = { schema: 'WHOLE_PRODUCTION_WORKER_STUB_ORDERING_RESULT', recipe: preparation.recipeSha256, preparationSha256: hash(preparationBytes), rows, pass: rows.filter(row => row.status === 'PASS').length, fail: rows.filter(row => ['FAIL_ASSERTION', 'UNSAFE_STOP'].includes(row.status)).length, unrun: rows.filter(row => row.status.startsWith('UNRUN')).length, unsafe, workers: ledger.entries, metadataStubChildren: metadata, realEngines: 0, realGitAuthority: 0, C11: 0, admission: 0, semantics: 0, historicalRescore: false };
const reference = store.save('RESULT.json', result);
writer.emit({ kind: 'final', report: { pass: result.pass, fail: result.fail, unrun: result.unrun, unsafe, reference, allChildrenReaped: ledger.entries.every(entry => entry.reaped) && metadata.every(entry => entry.reaped) } });
process.stdout.write(`${JSON.stringify({ pass: result.pass, fail: result.fail, unrun: result.unrun, unsafe, workers: ledger.entries.length, metadataStubChildren: metadata.length, reference })}\n`);
process.exitCode = unsafe || result.fail || result.unrun ? 1 : 0;

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { authenticatePacket } from './authorization.mjs';
import { authenticateBootstrap } from './bootstrap.mjs';
import { dataObject, denseArray } from './schema.mjs';
import { parseTransport } from './transport.mjs';
import { createEvidenceBudget } from './evidence.mjs';
import { createStore, encode, digest } from './records.mjs';
import { boundFile } from './projection.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const recipe = authenticatePacket(root);
const projection = JSON.parse(fs.readFileSync(path.join(root, '../executor-v3/PROJECTION.json')));
const guard = () => { assert.equal(authenticatePacket(root), recipe); for (const tool of projection.tools) boundFile(tool.path, tool); };
guard();
assert.equal(process.execPath, projection.tools.find(tool => tool.role === 'node').path);
assert(process.execArgv.includes('--unhandled-rejections=strict') && process.execArgv.includes('--max-old-space-size=256'));
const work = path.join(root, 'runs/focused-r1-01'); fs.mkdirSync(work);
const budget = createEvidenceBudget(work, { limit: 1048576 });
const store = createStore(work, { budget });
const rows = [];
store.save('PRE.json', { recipe, tools: projection.tools, preExecutionProtocol: 'FOCUSED-PROTOCOL.json', dataOnly: true, oldScore: '31/33 unchanged', newChildLaunches: 0 });

function assessBoundary(receipt) {
  try {
    const value = dataObject(receipt, ['pid', 'exit', 'close', 'reaped', 'failures', 'signals', 'records', 'captureBytes', 'stdout', 'stderr', 'rawRecords', 'natural']);
    if (!value || !Number.isSafeInteger(value.pid) || value.pid <= 0 || value.reaped !== true || value.natural !== false) return false;
    for (const name of ['exit', 'close']) { const result = dataObject(value[name], ['code', 'signal']); if (!result || result.code !== 1 || result.signal !== null) return false; }
    for (const name of ['failures', 'signals']) { const result = denseArray(value[name], 64); if (!result || result.length) return false; }
    const counts = dataObject(value.captureBytes, ['stdout', 'stderr', 'records']);
    if (!counts) return false;
    const captured = {};
    for (const [field, counter, maximum] of [['stdout', 'stdout', 65536], ['stderr', 'stderr', 65536], ['rawRecords', 'records', 262144]]) {
      if (typeof value[field] !== 'string' || !Number.isSafeInteger(counts[counter]) || counts[counter] < 0 || counts[counter] > maximum) return false;
      const bytes = Buffer.from(value[field], 'base64'); if (bytes.length !== counts[counter] || bytes.toString('base64') !== value[field]) return false; captured[field] = bytes;
    }
    if (captured.stderr.length) return false;
    const records = parseTransport(captured.rawRecords);
    if (encode(records).toString() !== encode(value.records).toString() || records.length !== 1) return false;
    const final = dataObject(records[0], ['sequence', 'kind', 'report']);
    const report = final && dataObject(final.report, ['mode', 'runId', 'status', 'unsafe', 'result', 'children', 'allChildrenReaped']);
    if (!report || report.mode !== 'invalid' || report.runId !== 'never-admission' || report.status !== 'UNSAFE_STOP' || report.unsafe !== true || report.result !== null || report.children !== 0 || report.allChildrenReaped !== true) return false;
    const terminal = dataObject(JSON.parse(captured.stdout), ['schema', 'mode', 'runId', 'status', 'unsafe', 'exitCode', 'primary', 'result', 'launchAccounting', 'children', 'failures', 'historicalScoresUnchanged']);
    if (!terminal || terminal.schema !== 'BOUNDED_TERMINAL_V2' || terminal.mode !== report.mode || terminal.runId !== report.runId || terminal.status !== report.status || terminal.unsafe !== true || terminal.exitCode !== 1 || terminal.result !== null || terminal.historicalScoresUnchanged !== true) return false;
    const children = denseArray(terminal.children, 0), failures = denseArray(terminal.failures, 1), primary = dataObject(terminal.primary, ['present', 'undefinedValue']);
    const accounting = dataObject(terminal.launchAccounting, ['enrolled', 'attempted', 'launched', 'closed', 'unknownAcquisitions', 'allChildrenReaped', 'unsafe']);
    if (!children || !failures || failures.length !== 1 || !primary || primary.present !== true || primary.undefinedValue !== false || !accounting) return false;
    const failure = dataObject(failures[0], ['phase', 'code']);
    return failure?.phase === 'prepare-or-publication' && failure.code === 'REPORT_STORE_UNAVAILABLE' && ['enrolled', 'attempted', 'launched', 'closed', 'unknownAcquisitions'].every(name => accounting[name] === 0) && accounting.allChildrenReaped === null && accounting.unsafe === false;
  } catch { return false; }
}

async function run(id, action) {
  let observation, failure;
  try { guard(); observation = await action(); } catch (error) { failure = { code: error.code ?? null, message: error.message, stack: error.stack }; }
  guard(); budget.audit();
  const row = { id, pass: !failure, observation, failure };
  rows.push(row); store.save(`${id}.json`, row);
}
await run('G08-r1', () => {
  const original = fs.readFileSync(path.join(root, '../executor-v7/bootstrap.mjs'), 'utf8');
  const updated = fs.readFileSync(path.join(root, 'bootstrap.mjs'), 'utf8');
  assert.equal(updated, original.replace('entry?.sha256 === sha256 && entry.bytes === bytes && entry.mode === 0o644', 'entry?.sha256 === sha256 && entry.bytes === bytes && entry.mode === 0o444'));
  const config = JSON.parse(fs.readFileSync(path.join(root, '../executor-v6/runs/admission-v6-01/child-003.json')));
  const parent = pathToFileURL(path.join(root, 'worker.mjs')).href;
  const value = authenticateBootstrap(config.view, parent, parent, projection);
  const checks = [
    ['wrong-parent', () => authenticateBootstrap(config.view, `${parent}?alias`, parent, projection), 'BOOTSTRAP_PARENT'],
    ['missing-parent', () => authenticateBootstrap(config.view, undefined, parent, projection), 'BOOTSTRAP_PARENT'],
    ['wrong-entry', () => authenticateBootstrap({ ...config.view, consumerPath: 'wrong.mjs' }, parent, parent, projection), 'BOOTSTRAP_ENTRY'],
    ['wrong-engine', () => authenticateBootstrap({ ...config.view, engine: 'virtual-bash' }, parent, parent, projection), 'BOOTSTRAP_ENGINE'],
    ['wrong-mode', () => authenticateBootstrap({ ...config.view, files: config.view.files.map(entry => entry.path.endsWith('/bundle/index.js') ? { ...entry, mode: 0o644 } : entry) }, parent, parent, projection), 'BOOTSTRAP_SOURCE'],
    ['wrong-hash', () => authenticateBootstrap({ ...config.view, files: config.view.files.map(entry => entry.path.endsWith('/bundle/index.js') ? { ...entry, sha256: '0'.repeat(64) } : entry) }, parent, parent, projection), 'BOOTSTRAP_SOURCE'],
  ];
  for (const [_name, operation, code] of checks) assert.throws(operation, error => error.code === code);
  return { value, positive: 1, negatives: checks.map(([name, _operation, code]) => ({ name, code })), actualSourceReadOnly: true, sourceMode: 0o444, consumerMode: 0o644, noEngineImport: true };
});
await run('B16-r1', () => {
  const base = path.join(root, '../executor-v7/runs/evidence-v7-01');
  const manifestBytes = fs.readFileSync(path.join(base, 'MANIFEST.json'));
  assert.equal(digest(manifestBytes), 'c003c7b8f00cadec085646a53ac865f5b72220d3c00c3c7f9a2f575e3c1f9ec1');
  const manifest = JSON.parse(manifestBytes);
  const parts = manifest.parts.map(entry => boundFile(path.join(base, entry.path), entry));
  const compressed = Buffer.concat(parts); assert.equal(digest(compressed), manifest.gzipSha256); assert.equal(compressed.length, manifest.compressedBytes);
  const text = gunzipSync(compressed, { maxOutputLength: 64 * 1024 * 1024 }).toString();
  const target = 'runs/synthetic-v7-01/B16/outer/COORDINATOR-RECEIPT.json';
  const entry = text.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(row => row.path === target);
  const expected = manifest.files.find(row => row.path === target); assert(entry && expected);
  const bytes = Buffer.from(entry.base64, 'base64'); assert.equal(bytes.length, expected.bytes); assert.equal(digest(bytes), expected.sha256);
  const receipt = JSON.parse(bytes); assert(assessBoundary(receipt));
  const variants = [
    ['integer-count-missing', value => { delete value.records[0].report.children; }],
    ['integer-count-array', value => { value.records[0].report.children = []; }],
    ['integer-count-nonzero', value => { value.records[0].report.children = 1; }],
    ['wrong-operation', value => { value.records[0].report.mode = 'admission'; }],
    ['wrong-exit', value => { value.exit.code = 0; }],
    ['capture-incomplete', value => { value.captureBytes.stdout++; }],
  ];
  for (const [name, mutate] of variants) {
    const changed = structuredClone(receipt); mutate(changed);
    if (name.startsWith('integer') || name === 'wrong-operation') { const raw = Buffer.concat(changed.records.map(row => encode(row))); changed.rawRecords = raw.toString('base64'); changed.captureBytes.records = raw.length; }
    assert.equal(assessBoundary(changed), false, name);
  }
  return { receiptPath: target, receiptSha256: expected.sha256, actualOldPid: receipt.pid, actualOldExit: receipt.exit, actualOldClose: receipt.close, oldReaped: receipt.reaped, positive: 1, negativeNames: variants.map(([name]) => name), newChildren: 0, qualificationTiming: 'POST_CAPTURE_PRESEALED_OBSERVER_RECONCILIATION', historicalB16FailureUnchanged: true };
});
guard();
const final = { schema: 'V7_R1_FOCUSED_OUTCOME', recipe, pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length, total: 2, rows, actualEngineImports: 0, newChildLaunches: 0, oldV7: '31/33 unchanged', wholeCohortRerun: false, freshAdmissionGrantRequired: true };
const reference = store.save('RESULT.json', final); budget.audit();
fs.writeSync(1, encode({ pass: final.pass, fail: final.fail, reference, newChildren: 0, actualEngines: 0 }, 8192));
process.exitCode = final.fail ? 1 : 0;

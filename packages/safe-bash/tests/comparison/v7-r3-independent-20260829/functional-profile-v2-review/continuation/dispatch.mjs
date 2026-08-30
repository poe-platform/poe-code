import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
const home = path.dirname(fileURLToPath(import.meta.url));
const seal = JSON.parse(fs.readFileSync(path.join(home, 'PRESEAL.json')));
const allowed = new Map([...seal.allowedModules, ...seal.own].map(row => [row.path, row]));
const loads = [];
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[key] = () => { throw Error('CHILD_FORBIDDEN'); };
syncBuiltinESMExports();
const hooks = registerHooks({ load(url, context, next) {
  if (!url.startsWith('file:')) return next(url, context);
  const filename = fileURLToPath(url), row = allowed.get(filename);
  if (!row || /\/(owner|worker|launch|coordinator|production)\.mjs$/.test(filename)) throw Error('LOAD_REFUSAL');
  const info = fs.lstatSync(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== row.bytes || (info.mode & 511) !== row.mode || info.size > 262144) throw Error('LOAD_METADATA');
  if (createHash('sha256').update(fs.readFileSync(filename)).digest('hex') !== row.sha256) throw Error('LOAD_HASH');
  loads.push(row); fs.writeSync(3, JSON.stringify({ kind: 'authenticated-file-load-request', ...row }) + '\n');
  return next(url, context);
} });
let result;
try {
  const { createInvocationRecorder, invocationContext, receiptInvocations, aggregateInvocations } = await import('../../../breadth-continuation-20260828/executor-v7-r3/runs/semantic-functional-profile-v2-20260829/invocations.mjs');
  const contexts = ['target-installed', 'baseline-installed'].map((layout, index) => invocationContext({ operationId: 'case-' + (index + 1), operationOrdinal: index + 1, launchOrdinal: index + 1, specimenSha256: 'a'.repeat(64), layout }));
  const events = [[], []];
  const first = createInvocationRecorder(contexts[0], event => events[0].push(event));
  await first.invoke('empty-setup', null, () => 0, []); await first.invoke('semantic', null, () => 0, []);
  const second = createInvocationRecorder(contexts[1], event => events[1].push(event));
  let caught = false, reason;
  try { await second.invoke('semantic', null, () => Promise.reject(false), []); } catch (error) { caught = true; reason = error; }
  function receipt(values, terminal) {
    const records = [...values, ...(terminal ? [{ kind: 'final', report: { synthetic: true } }] : [])].map((row, sequence) => ({ sequence, ...row }));
    const bytes = Buffer.from(records.map(row => JSON.stringify(row) + '\n').join(''));
    return { pid: 900001, exit: { code: 0, signal: null }, close: { code: 0, signal: null }, reaped: true, failures: [], signals: [], records, captureBytes: { stdout: 0, stderr: 0, records: bytes.length }, stdout: '', stderr: '', rawRecords: bytes.toString('base64'), natural: true };
  }
  const counts = aggregateInvocations(events.map((rows, index) => ({ operationId: contexts[index].operationId, operationOrdinal: index + 1, counts: receiptInvocations(receipt(rows, true), contexts[index]) })));
  result = { id: 'N07-v2-terminal-envelope', status: 'OBSERVED_BEFORE_ASSERTIONS', counts, caught, reason, original: 'N07 FINAL_ENVELOPE: 4 unchanged', syntheticLegacyCompleted: { semantic: 1, emptySetup: 1 }, historicalReconstruction: false, loads, actualEngines: 0, actualWorkers: 0, children: 0 };
  fs.writeFileSync(path.join(home, 'OBSERVATION.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  assert.equal(caught, true); assert.equal(reason, false);
  assert.deepEqual(counts.semantic, { attempted: 2, fulfilled: 1, rejected: 1, unresolved: 0 });
  assert.equal(counts.emptySetup.attempted, 1); assert.equal(counts.totalAttempted, 3); assert.equal(counts.dispatchAttemptIsCalleeEntry, false);
  assert.throws(() => receiptInvocations(receipt(events[0], false), contexts[0]), error => error.code === 'FINAL_ENVELOPE');
  result.status = 'PASS'; result.missingFinalNegative = 'REFUSED';
} catch (error) { result = { ...result, status: 'FAIL', code: error?.code ?? null, message: String(error?.message ?? error), loads }; process.exitCode = 1; }
finally { hooks.deregister(); }
fs.writeFileSync(path.join(home, 'RESULT.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
process.stdout.write(JSON.stringify({ id: result.id, status: result.status, code: result.code ?? null, actualEngines: 0, children: 0 }) + '\n');

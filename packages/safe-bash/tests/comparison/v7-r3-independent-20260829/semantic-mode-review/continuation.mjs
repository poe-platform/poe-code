import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import childProcess from 'node:child_process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
const home = path.dirname(fileURLToPath(import.meta.url));
const output = fs.openSync(path.join(home, 'CONTINUATION-RESULT.json'), 'wx', 0o600);
const observations = fs.openSync(path.join(home, 'CONTINUATION-OBSERVATIONS.ndjson'), 'wx', 0o600);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const rows = [];
const loads = [];
let hooks;
let failure = null;
try {
  const guardBytes = fs.readFileSync(path.join(home, 'CONTINUATION-SEAL.json'));
  assert.equal(hash(guardBytes), process.argv[2]);
  const guard = JSON.parse(guardBytes);
  for (const binding of guard.own) { const info = fs.lstatSync(binding.path); assert(info.isFile() && !info.isSymbolicLink() && info.size === binding.bytes && info.size <= 262144); assert.equal(hash(fs.readFileSync(binding.path)), binding.sha256); }
  const originalBytes = fs.readFileSync(path.join(home, 'PRESEAL.json')); assert.equal(hash(originalBytes), guard.originalPresealSha256);
  const original = JSON.parse(originalBytes);
  for (const row of original.inputs) { const info = fs.lstatSync(row.path); assert(info.isFile() && !info.isSymbolicLink() && info.size === row.bytes && (info.mode & 511) === row.mode && info.size <= 262144); assert.equal(hash(fs.readFileSync(row.path)), row.sha256); }
  const allowed = new Map([...original.allowedModules, ...original.own].map(row => [row.path, row]));
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = () => { throw Error('CONTINUATION_PROCESS_FORBIDDEN'); };
  syncBuiltinESMExports();
  hooks = registerHooks({ load(url, context, next) {
    if (!url.startsWith('file:')) return next(url, context);
    const file = fileURLToPath(url); assert(!/\/(owner|launch|worker|coordinator|production)\.mjs$/.test(file), 'REAL_ENTRYPOINT');
    const row = allowed.get(file); assert(row, 'UNBOUND_MODULE'); const info = fs.lstatSync(file); assert(info.isFile() && !info.isSymbolicLink() && info.size === row.bytes && (info.mode & 511) === row.mode && info.size <= 262144); assert.equal(hash(fs.readFileSync(file)), row.sha256); loads.push({ path: file, sha256: row.sha256 });
    return next(url, context);
  } });
  const { compose } = await import('./generated/fixtures.mjs');
  for (const spec of [{ id: 'N03-v2', name: 'missing', completed: 0, code: 'INDEPENDENT_MISSING_OPERATION' }, { id: 'N04-v2', name: 'duplicate', completed: 1, code: 'OPERATION_ORDER' }]) {
    const value = await compose(`independent-${spec.name}-operation-v2`, { tweak(drivers) {
      if (spec.completed === 0) drivers.selectOperation = () => { throw Object.assign(new Error('MISSING_OPERATION'), { code: spec.code }); };
      else { const select = drivers.selectOperation; let first; drivers.selectOperation = (...args) => { const selected = select(...args); return first ??= selected; }; }
    } });
    const captured = { id: spec.id, output: value.result.output, publication: value.result.publication, receipt: value.receipt, ledger: value.result.ledger };
    const raw = Buffer.from(JSON.stringify(captured) + '\n'); assert(raw.length < 1048576, 'OBSERVATION_BOUND'); fs.writeSync(observations, raw); fs.fsyncSync(observations);
    function validate(candidate) {
      assert.equal(candidate.output.status, 'UNSAFE_STOP'); assert.equal(candidate.output.unsafe, true); assert.equal(candidate.output.cohort.rows.length, 99); assert.equal(candidate.output.cohort.rows[spec.completed].error.code, spec.code);
      assert.equal(candidate.ledger.length, spec.completed); assert(candidate.ledger.every(row => row.reaped === true)); assert(candidate.output.cohort.rows.slice(spec.completed + 1).every(row => row.status === 'UNRUN_UNSAFE_TAIL'));
      assert.equal(candidate.publication.exitCode, 1); assert.equal(candidate.receipt.exit.code, 1); assert.equal(candidate.receipt.close.code, 1);
      const terminal = JSON.parse(Buffer.from(candidate.receipt.stdout, 'base64')); assert.equal(terminal.status, 'UNSAFE_STOP'); assert.equal(terminal.exitCode, 1); assert.equal(terminal.unsafe, true);
    }
    try {
      validate(captured);
      for (const mutate of [copy => { copy.output.cohort.rows[spec.completed].error.code = 'WRONG'; }, copy => { copy.output.unsafe = false; }, copy => { copy.ledger.push({ reaped: true }); }]) { const bad = structuredClone(captured); mutate(bad); assert.throws(() => validate(bad)); }
      rows.push({ id: spec.id, pass: true, code: spec.code, capturedBeforeAssertions: true, modeledChildren: spec.completed, negativeDataMutationsRejected: 3, observationSha256: hash(raw) });
    } catch (error) { rows.push({ id: spec.id, pass: false, message: error.message }); }
  }
  for (const row of original.inputs) assert.equal(hash(fs.readFileSync(row.path)), row.sha256);
} catch (error) { failure = { message: String(error?.message).slice(0, 2000), code: error?.code ?? null }; }
finally { hooks?.deregister(); fs.fsyncSync(observations); fs.closeSync(observations); }
const result = { schema: 'SEMANTIC_N03_N04_FIXTURE_V2', originalIndependent: '10/12 preserved', rows, failure, loads, realChildren: 0, actualAuthority: false, sourceChanges: 0 };
fs.writeSync(output, JSON.stringify(result, null, 2) + '\n'); fs.fsyncSync(output); fs.closeSync(output);
process.stdout.write(JSON.stringify({ rows, failure, realChildren: 0 }) + '\n');
process.exitCode = failure || rows.length !== 2 || rows.some(row => !row.pass) ? 1 : 0;

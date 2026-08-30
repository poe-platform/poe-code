import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const isolated = path.resolve(process.argv[2] ?? '');
assert.ok(isolated.startsWith(`${directory}/isolated-`));
const provenance = JSON.parse(readFileSync(path.join(isolated, 'provenance.json')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const check = () => {
  for (const entry of provenance.emitted) assert.equal(hash(readFileSync(path.join(isolated, 'compiled', entry.path))), entry.sha256, entry.path);
};
check();
const threads = createRequire(import.meta.url)('node:worker_threads');
const NativeWorker = threads.Worker;
const workers = [];
class ObservedWorker extends NativeWorker {
  closed = false;
  constructor(filename, options) { super(filename, options); workers.push(this); this.once('exit', () => { this.closed = true; }); }
}
threads.Worker = ObservedWorker;
syncBuiltinESMExports();
const load = filename => import(pathToFileURL(path.join(isolated, 'compiled/src/commands', filename)).href);
const protocol = await load('regex-execution/protocol.js');
const { RegexExecutor } = await load('regex-execution/client.js');
const frozen = JSON.parse(readFileSync(path.join(directory, 'CASES.json')));
const descriptor = (pattern, limits = {}) => ({ kind: 'expr-match', pattern: Buffer.from(pattern), profile: 'byte', limits: { ...protocol.exprMatchCeilings, ...limits } });
const target = descriptor('\\(a*\\)*\\1');
const subject = Buffer.from('aaa');
const result = { started: new Date().toISOString(), workerSha256: provenance.workerSha256, driverSha256: hash(readFileSync(fileURLToPath(import.meta.url))), controls: [], resourceProbes: [] };
const control = async (id, action) => {
  try { result.controls.push({ id, passed: true, detail: await action() }); }
  catch (error) { result.controls.push({ id, passed: false, error: { name: error.name, category: error.category, code: error.code, message: error.message, stack: error.stack } }); }
};
const executor = new RegexExecutor();
const session = executor.open(new AbortController().signal);
const limit = (error, message) => error instanceof protocol.ExprMatchError && error.category === 'limit' && error.message.includes(message);
const probe = async (key, value) => {
  try {
    const matched = await session.matchExpr({ ...target, limits: { ...target.limits, [key]: value } }, subject);
    result.resourceProbes.push({ key, value, accepted: true, result: matched });
    return matched;
  } catch (error) {
    assert.ok(limit(error, key === 'maxStates' ? 'states' : key === 'maxSteps' ? 'work' : 'allocation'));
    result.resourceProbes.push({ key, value, accepted: false, category: error.category, message: error.message });
    return null;
  }
};
try {
  for (const key of ['maxPatternBytes', 'maxSubjectBytes']) await control(`corrected/${key}`, () => {
    assert.throws(() => session.matchExpr(descriptor(frozen.controls.limitPattern, { [key]: 1 }), Buffer.from(frozen.controls.limitSubject)), error => limit(error, 'input bytes'));
    return { synchronous: true, identity: 'ExprMatchError', category: 'limit', message: 'regex input bytes limit exceeded' };
  });
  await control('corrected/pre-abort-identity', async () => {
    const controller = new AbortController();
    const reason = Object.freeze({ code: 'ENOENT', marker: 'independent-abort-reason' });
    controller.abort(reason);
    const aborted = new RegexExecutor().open(controller.signal);
    try { assert.throws(() => aborted.matchExpr(target, subject), error => error === reason); }
    finally { await aborted.close(); }
    return { synchronous: true, exactReasonPreserved: true };
  });
  await control('boundary/maxSteps', async () => {
    const baseline = await session.matchExpr(target, subject);
    assert.deepEqual(await probe('maxSteps', baseline.steps), baseline);
    assert.equal(await probe('maxSteps', baseline.steps - 1), null);
    return { minimum: baseline.steps };
  });
  for (const key of ['maxStates', 'maxAllocatedUnits']) await control(`boundary/${key}`, async () => {
    let low = 1;
    let high = protocol.exprMatchCeilings[key];
    assert.ok(await probe(key, high));
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (await probe(key, middle)) high = middle;
      else low = middle + 1;
    }
    assert.ok(await probe(key, low));
    assert.ok(low > 1);
    assert.equal(await probe(key, low - 1), null);
    return { minimum: low, searchedInterval: [1, protocol.exprMatchCeilings[key]] };
  });
  await control('bounded/nested-growth', async () => {
    const rows = [];
    for (const length of [4, 8, 12]) {
      const bytes = Buffer.from('a'.repeat(length));
      const request = descriptor(frozen.controls.limitPattern, { maxSteps: 20000, maxStates: 1000, maxAllocatedUnits: 30000 });
      try {
        const matched = await session.matchExpr(request, bytes);
        protocol.validateExprReply({ id: 1, operation: 'expr-match', result: matched }, 1, request, bytes, new AbortController().signal);
        rows.push({ length, result: matched, interpretation: 'valid bounded observation only' });
      } catch (error) {
        assert.ok(error instanceof protocol.ExprMatchError && error.category === 'limit');
        rows.push({ length, category: error.category, message: error.message, interpretation: 'bounded refusal, not a semantic pass' });
      }
    }
    return rows;
  });
} finally {
  await session.close();
  await executor.close();
  const activeBeforeSafetyCleanup = workers.filter(worker => !worker.closed).length;
  await Promise.all(workers.filter(worker => !worker.closed).map(worker => worker.terminate()));
  threads.Worker = NativeWorker;
  syncBuiltinESMExports();
  result.cleanup = { workers: workers.length, activeBeforeSafetyCleanup, activeAfter: workers.filter(worker => !worker.closed).length };
  check();
  result.integrity = 'All originally enumerated compiled bytes rechecked; no append-proof claim from this follow-up alone.';
  result.finished = new Date().toISOString();
  result.counts = { controls: result.controls.length, passed: result.controls.filter(row => row.passed).length, resourceProbes: result.resourceProbes.length };
  writeFileSync(path.join(isolated, 'controls-followup.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ counts: result.counts, controls: result.controls, cleanup: result.cleanup }));
}

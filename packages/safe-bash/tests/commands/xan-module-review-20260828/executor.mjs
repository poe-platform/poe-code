import assert from 'node:assert/strict';
import { bytes, check, Hold, sha, reasonIdentity } from './core.mjs';
import { source, sink, mockFS, faithfulCSV } from './mocks.mjs';

export function casesFrom(documents) {
  const baseline = documents['final-freeze-v3/CASES.json'].cases.map(row => ({ ...row, group: 'prior88' }));
  const selector = documents['SELECTOR-FREEZE-V4.json'];
  const selectors = selector.cases.map(row => ({
    ...row, group: 'selector36', stdin: { utf8: selector.fixtures[row.fixture] },
    expected: row.class === 'VALID'
      ? { status: selector.successDefaults.status, stdout: { utf8: row.stdoutUtf8 }, stderr: { utf8: selector.successDefaults.stderrUtf8 }, files: {} }
      : { status: selector.failureDefaults.status, stdout: { utf8: selector.failureDefaults.stdoutUtf8 }, stderr: selector.failureDefaults.stderr, files: {} },
  }));
  const ratification = documents['B01-RATIFICATION-7.json'];
  const ratifications = ratification.rules.flatMap(rule => rule.cases.map(row => {
    const expected = row.expected === 'rejection' ? ratification.rejection : row.expected;
    return { ...row, group: 'ratification14', rule: rule.id, stdin: { utf8: ratification.commonInputUtf8 }, expected: { status: expected.status, stdout: { utf8: expected.stdoutUtf8 }, stderr: expected.stderr ?? { utf8: expected.stderrUtf8 }, files: {} } };
  }));
  check(baseline.length === 88 && selectors.length === 36 && ratifications.length === 14, 'CASE_INVENTORY');
  check(selectors.filter(row => row.class === 'VALID').length === 21 && selectors.filter(row => ['S', 'N'].includes(row.class)).length === 7 && selectors.filter(row => row.class === 'R').length === 8, 'SELECTOR_CLASSIFICATION');
  return [...baseline, ...selectors, ...ratifications];
}
export async function executeCase(execute, row, options = {}) {
  check(typeof execute === 'function', 'EXECUTE_BINDING');
  const input = bytes(row.stdin);
  const controller = new AbortController();
  const stream = source(input, { schedule: options.schedule ?? 'P0', reuse: options.reuse, poisonAcquire: row.phase === 'BEFORE_IO', ...options.source, signal: controller.signal });
  const stdout = sink(options.outputBytes ?? 65536, { retain: true });
  const stderr = sink(options.outputBytes ?? 65536, { retain: true });
  const filesystem = mockFS(row.files, { poison: row.phase === 'BEFORE_IO', ...options.fs });
  const cleanup = [];
  const events = [];
  let result;
  let escaping;
  let failed = false;
  try {
    result = await execute({ command: 'xan', args: [...row.argv], stdin: stream, stdinIsDefault: options.stdinIsDefault ?? false, stdout, stderr, cwd: '/work', env: {}, fs: filesystem.fs, signal: controller.signal, registerCleanup(callback) { check(typeof callback === 'function', 'CLEANUP_TYPE'); events.push('registerCleanup'); cleanup.push(callback); } });
  } catch (error) { failed = true; escaping = error; }
  const cleanups = await Promise.allSettled(cleanup.map(callback => Promise.resolve().then(callback)));
  const record = { id: row.id, result, failed, reason: failed ? reasonIdentity(escaping, options.reasons ?? []) : null, stdout: stdout.finish(), stderr: stderr.finish(), files: filesystem.snapshot(), inputEvents: stream.events, fsEvents: filesystem.events, events, cleanup: { registered: cleanup.length, drained: true, failures: cleanups.filter(outcome => outcome.status === 'rejected').length }, scope: 'DIRECT_COMMAND_NOT_PUBLIC_SETTLEMENT' };
  if (options.receipt) await options.receipt(record);
  check(record.cleanup.failures === 0, 'CLEANUP_FAILED');
  return record;
}
export function assertCase(row, record, semantics = new Map()) {
  check(!record.failed, 'ESCAPING_EXECUTION');
  check(record.result && Number.isInteger(record.result.exitCode), 'RESULT_TYPE');
  assert.equal(record.result.exitCode, row.expected.status);
  if (row.assertionMode === 'HISTORICAL_BYTE_COMPARISON_PLUS_PROJECT_SEMANTICS') assert.deepEqual(faithfulCSV(record.stdout.data), row.projectLogicalRecords);
  else assert.deepEqual(record.stdout.data, bytes(row.expected.stdout));
  assert.deepEqual(Object.keys(record.files).sort(), Object.keys(row.expected.files).sort());
  for (const [name, datum] of Object.entries(row.expected.files)) assert.deepEqual(record.files[name], bytes(datum));
  assert.equal(record.inputEvents.filter(event => event === 'return' || event === 'throw').length, 0);
  if (row.phase === 'BEFORE_IO') { assert.equal(record.inputEvents.length, 0); assert.equal(record.fsEvents.length, 0); }
  if (row.phase === 'AFTER_FIRST_RECORD_BEFORE_SELECTED_OUTPUT') {
    assert.equal(record.inputEvents.filter(event => event === 'next').length, 1);
    assert.equal(record.fsEvents.filter(event => event.method.startsWith('write')).length, 0);
  }
  if (row.expected.stderr.precision) {
    const matcher = semantics.get(row.id);
    check(matcher && typeof matcher.assert === 'function' && /^[a-f0-9]{64}$/.test(matcher.reviewBinding), 'SEMANTIC_REVIEW_REQUIRED', row.id);
    matcher.assert(record.stderr.data, row);
  } else assert.deepEqual(record.stderr.data, bytes(row.expected.stderr));
  return { status: 'ASSERTED', historicalByteEqual: row.id === 'O18' ? sha(record.stdout.data) === sha(bytes(row.expected.stdout)) : undefined };
}
export async function aggregate(tasks, integrity, report) {
  const results = [];
  for (const task of tasks) {
    const result = await task.run();
    await report({ id: task.id, stage: 'RECEIPT', result });
    check(result.reaped === true && result.closed === true, 'DEPENDENTS_HELD_CLEANUP');
    await integrity();
    try { await task.assert(result); results.push({ id: task.id, status: 'ASSERTED' }); }
    catch (error) {
      if (error instanceof Hold) throw error;
      results.push({ id: task.id, status: 'ASSERTION_FAILED', name: error.name });
    }
    await report(results.at(-1));
  }
  return { results, exitCode: results.some(result => result.status === 'ASSERTION_FAILED') ? 1 : 0 };
}

import assert from 'node:assert/strict';
import { bytes, sha } from '../core.mjs';
import { source, sink, mockFS, faithfulCSV, schedule } from '../mocks.mjs';
import { matcherMap } from './diagnostics.mjs';

export function normalize(documents) {
  const prior = documents['final-freeze-v3/CASES.json'].cases.map(row => ({ ...row, group: 'prior88' }));
  const selector = documents['SELECTOR-FREEZE-V4.json'];
  const selectors = selector.cases.map(row => ({ ...row, group: 'selector36', stdin: { utf8: selector.fixtures[row.fixture] },
    expected: { status: row.class === 'VALID' ? 0 : 1, stdout: { utf8: row.stdoutUtf8 ?? '' }, stderr: row.class === 'VALID' ? { utf8: '' } : selector.failureDefaults.stderr, files: {} } }));
  const ratification = documents['B01-RATIFICATION-7.json'];
  const ratifications = ratification.rules.flatMap(rule => rule.cases.map(row => {
    const expected = row.expected === 'rejection' ? ratification.rejection : row.expected;
    return { ...row, rule: rule.id, group: 'ratification14', stdin: { utf8: ratification.commonInputUtf8 },
      expected: { status: expected.status, stdout: { utf8: expected.stdoutUtf8 }, stderr: expected.stderr ?? { utf8: expected.stderrUtf8 }, files: {} } };
  }));
  assert.equal(prior.length, 88); assert.equal(selectors.length, 36); assert.equal(ratifications.length, 14);
  assert.deepEqual(['VALID', 'S', 'N', 'R'].map(kind => selectors.filter(row => row.class === kind).length), [21, 5, 2, 8]);
  return [...prior, ...selectors, ...ratifications];
}

export function beforeIO(row) {
  return row.phase === 'BEFORE_IO' || /^R0[1-5]$/.test(row.id) || row.rule === 'B01-R1' || row.rule === 'B01-R6';
}

export function headerBoundary(row) {
  if (row.group === 'selector36') return bytes(row.stdin).indexOf(10) + 1;
  return undefined;
}

export function assertPhase(row, record) {
  assert.equal(record.inputEvents.filter(event => event === 'return' || event === 'throw').length, 0, 'borrowed lifetime');
  if (beforeIO(row)) {
    assert.equal(record.inputEvents.length, 0, 'before iterator acquisition');
    assert.equal(record.fsEvents.length, 0, 'before metadata and publication');
  }
  if (row.phase === 'AFTER_FIRST_RECORD_BEFORE_SELECTED_OUTPUT') {
    const boundary = headerBoundary(row);
    assert.ok(boundary > 0, 'trusted fixture boundary');
    const chunks = record.deliveryLengths;
    let delivered = 0;
    let required = 0;
    while (delivered < boundary && required < chunks.length) delivered += chunks[required++];
    assert.ok(delivered >= boundary, 'logical record complete');
    assert.equal(record.inputEvents.filter(event => event === 'next').length, required, 'stop when first logical record known');
    assert.equal(record.chargedInputBytes, delivered, 'whole delivered read-ahead charged');
    assert.equal(record.fsEvents.filter(event => event.method.startsWith('write')).length, 0);
  }
}

export function assertCase(row, record, matchers) {
  assert.equal(record.failed, false, 'escaping execution');
  assert.equal(record.result?.exitCode, row.expected.status, 'status');
  if (row.assertionMode === 'HISTORICAL_BYTE_COMPARISON_PLUS_PROJECT_SEMANTICS') {
    assert.deepEqual(faithfulCSV(record.stdout.data), row.projectLogicalRecords, 'approved project logical records; native bytes retained separately');
  } else assert.deepEqual(record.stdout.data, bytes(row.expected.stdout), 'stdout bytes');
  assert.deepEqual(Object.keys(record.files).sort(), Object.keys(row.expected.files).sort(), 'namespace');
  for (const [name, datum] of Object.entries(row.expected.files)) assert.deepEqual(record.files[name], bytes(datum), `file ${name}`);
  if (row.expected.stderr.precision) matchers.get(row.id).assert(record.stderr.data, row);
  else assert.deepEqual(record.stderr.data, bytes(row.expected.stderr), 'inherited exact stderr');
  assertPhase(row, record);
  assert.equal(record.cleanup.drained, true);
  assert.equal(record.cleanup.failures, 0);
  if (row.id === 'Z02') assert.equal(record.inputEvents.length, 0, 'zero tail without header never acquires borrowed stdin');
  if (row.id === 'Z10') assert.equal(record.fsEvents.filter(event => event.method === 'readStream' || event.method === 'readFile').length, 0);
  return { id: row.id, assertion: 'EXACT_OR_FROZEN_CONTEXTUAL', rawStdoutSha256: sha(record.stdout.data) };
}

function reusedSource(input, options, lengths) {
  if (!options.reuse) return source(input, options);
  const events = [];
  const storage = options.reuse === 'buffer' ? Buffer.alloc(Math.max(1, ...lengths)) : new Uint8Array(Math.max(1, ...lengths));
  let offset = 0; let nextIndex = 0;
  const iterator = {
    async next() {
      events.push('next'); storage.fill(88);
      if (options.signal.aborted) throw options.signal.reason;
      if (nextIndex === lengths.length) return { done: true };
      const size = lengths[nextIndex++]; storage.set(input.subarray(offset, offset + size)); offset += size;
      events.push({ delivered: size }); return { done: false, value: storage.subarray(0, size) };
    },
    async return() { events.push('return'); storage.fill(88); return { done: true }; },
    async throw(reason) { events.push('throw'); storage.fill(88); throw reason; },
  };
  return { events, [Symbol.asyncIterator]() { events.push('acquire'); if (options.poisonAcquire) throw new Error('POISON_ACQUIRE'); return iterator; } };
}

export async function executeCase(execute, row, options = {}) {
  const input = bytes(row.stdin);
  const controller = new AbortController();
  const lengths = schedule(input.length, options.schedule ?? 'P0');
  const stream = reusedSource(input, { schedule: options.schedule ?? 'P0', reuse: options.reuse, poisonAcquire: beforeIO(row) || row.id === 'Z02', ...options.source, signal: controller.signal }, lengths);
  const stdout = sink(65536, { retain: true });
  const stderr = sink(65536, { retain: true });
  const filesystem = mockFS(row.files, { poison: beforeIO(row), ...options.fs });
  const cleanups = [];
  let result;
  let escaping;
  let failed = false;
  try {
    result = await execute({ command: 'xan', args: [...row.argv], stdin: stream, stdinIsDefault: options.stdinIsDefault ?? false,
      stdout, stderr, cwd: '/work', env: {}, fs: filesystem.fs, signal: controller.signal,
      registerCleanup(callback) { assert.equal(typeof callback, 'function'); cleanups.push(callback); } });
  } catch (error) { failed = true; escaping = error; }
  const drained = await Promise.allSettled(cleanups.map(callback => Promise.resolve().then(callback)));
  const nextCount = stream.events.filter(event => event === 'next').length;
  return { id: row.id, result, failed, escaping, stdout: stdout.finish(), stderr: stderr.finish(), files: filesystem.snapshot(),
    inputEvents: stream.events, fsEvents: filesystem.events, deliveryLengths: lengths,
    chargedInputBytes: lengths.slice(0, nextCount).reduce((total, size) => total + size, 0),
    cleanup: { drained: true, failures: drained.filter(outcome => outcome.status === 'rejected').length },
    scope: 'DIRECT_CONTEXT_NOT_SHELL_PUBLIC_SETTLEMENT' };
}

export function caseJobs(rows, controls) {
  const jobs = rows.map(row => ({ id: `${row.id}/P0`, row: row.id, schedule: 'P0', reuse: false }));
  for (const family of controls.families) {
    if (family.id === 'F02') for (const id of family.caseIds) {
      const row = rows.find(item => item.id === id);
      for (const name of ['P1', 'P2', 'P3', ...Array.from({ length: bytes(row.stdin).length - 1 }, (_, index) => `CUT:${index + 1}`)]) jobs.push({ id: `${id}/${name}`, row: id, schedule: name, reuse: false });
    }
    if (family.id === 'F03') for (const id of family.caseIds) for (const reuse of [false, true, 'buffer']) jobs.push({ id: `${id}/P2/reuse-${reuse}`, row: id, schedule: 'P2', reuse });
  }
  return jobs;
}

export { matcherMap };

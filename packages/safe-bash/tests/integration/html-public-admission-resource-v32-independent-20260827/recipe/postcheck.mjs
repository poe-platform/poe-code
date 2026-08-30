import assert from 'node:assert/strict';
import { readFileSync, openSync, closeSync, writeSync, fsyncSync } from 'node:fs';
import { join } from 'node:path';
import { owned, inventory, readJson, fileHash } from './authenticate.mjs';

const raw = join(owned, 'raw');
const execution = join(raw, 'execution-01');
const summary = readJson(join(execution, 'SUMMARY.json'));
const observation = Object.keys(inventory(join(raw, 'observations')).files).flatMap(path => readFileSync(join(raw, 'observations', path), 'utf8').trim().split('\n').map(line => JSON.parse(line)));
const supervisor = observation.find(row => row.type === 'observer-start' && row.argv[1] === join(owned, 'recipe/coordinator.mjs')).pid;
const checks = [], measurements = [];
function check(name, action) {
  try { const details = action(); checks.push({ name, passed: true, details: details ?? null }); }
  catch (error) { checks.push({ name, passed: false, error: { code: error.code, message: error.message, stack: error.stack } }); }
}
function observed(pid, type, match = () => true) {
  const rows = observation.filter(row => row.pid === pid && row.type === type && match(row));
  assert.ok(rows.length > 0, `${pid}:${type}`);
  return rows[0];
}
const before = (earlier, later) => assert.ok(BigInt(earlier.monotonicNs) < BigInt(later.monotonicNs), `${earlier.type} before ${later.type}`);
function durable(pid, path) { return observed(pid, 'fsync-completed', row => row.path === path); }
function validateMemory(directory, role, receipt) {
  const journal = readFileSync(join(directory, `${role}.samples.jsonl`), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(journal[0].memory, receipt.memory.baseline);
  const peaks = { ...journal[0].memory };
  for (const row of journal) for (const field of ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers']) {
    assert.ok(Number.isSafeInteger(row.memory[field]) && row.memory[field] >= 0);
    peaks[field] = Math.max(peaks[field], row.memory[field]);
  }
  assert.deepEqual(peaks, receipt.memory.fieldwisePeaks);
  assert.deepEqual(journal.at(-1).memory, receipt.memory.latest);
  assert.equal(journal.filter(row => row.type === 'memory').length, receipt.memory.samples);
}
check('exact five declared cases; saved results, no rescore', () => {
  assert.equal(summary.controlsDeclared, 5);
  assert.equal(summary.controlsExecuted, 5);
  assert.deepEqual(summary.rows.map(row => row.control), ['positive', 'producer-exit7', 'consumer-failure', 'timeout', 'allocation-mutant']);
  assert.equal(summary.expectedOutcomes, 5);
  assert.equal(summary.unexpectedFailures, 0);
  assert.deepEqual(summary.unexecuted, []);
  assert.equal(summary.actual34, 0);
  assert.equal(summary.full410BuildPackReconstruction, false);
  assert.equal(readJson(join(raw, 'LAUNCH-RESULT.json')).code, 0);
});
for (const row of summary.rows) {
  const directory = join(execution, row.directory);
  const record = readJson(join(directory, 'RAW-RECEIPT.json'));
  const consumer = readJson(join(directory, 'consumer.receipt.json'));
  const producer = readJson(join(directory, 'producer.receipt.json'));
  measurements.push({ control: row.control, savedOutcome: row.outcome, consumerPid: consumer.pid, producerPid: producer.pid, consumerTerminal: { code: record.code, signal: record.signal }, producerTerminal: { code: producer.status, signal: producer.signal }, forwardedCode: record.forwardedFailureCode, forwardedMessage: record.forwardedFailureMessage, consumerMemory: consumer.memory, producerMemory: producer.memory, supervisorMemoryExcluded: record.supervisorMemoryExcluded, consumerFlow: consumer.flow, producerFlow: producer.flow, mutation: consumer.mutation, resourceBoundary: record.resourceBoundary, coreMaxRss: consumer.result?.maxRssBytes ?? null, elapsedMs: Date.parse(record.harnessSettlementAt) - Date.parse(record.started) });
  check(`${row.control}: raw copies, saved safety and output hashes`, () => {
    assert.deepEqual(record.consumer.value, consumer);
    assert.deepEqual(record.producer.value, producer);
    assert.equal(readJson(join(directory, 'VERDICT.json')).outcome, row.outcome);
    assert.equal(readJson(join(directory, 'SAFETY.json')).safe, true);
    assert.equal(fileHash(join(directory, 'stdout.data')), record.outputHashes.stdout);
    assert.equal(fileHash(join(directory, 'stderr.data')), record.outputHashes.stderr);
    validateMemory(directory, 'consumer', consumer);
    validateMemory(directory, 'producer', producer);
  });
  check(`${row.control}: actual fsync completion before first postraw assertion`, () => {
    const receipt = durable(supervisor, join(directory, 'RAW-RECEIPT.json'));
    const assertion = observed(supervisor, 'first-assertion-after-raw', event => event.receipt === join(directory, 'RAW-RECEIPT.json'));
    before(receipt, assertion);
    before(durable(consumer.pid, join(directory, 'consumer.receipt.json')), receipt);
    before(durable(producer.pid, join(directory, 'producer.receipt.json')), receipt);
    return { receipt, assertion };
  });
  check(`${row.control}: observed producer and worker exit/close before raw settlement`, () => {
    const producerExit = observed(consumer.pid, 'child-exit', event => event.childPid === producer.pid);
    const producerClose = observed(consumer.pid, 'child-close', event => event.childPid === producer.pid);
    const workerExit = observed(supervisor, 'child-exit', event => event.childPid === consumer.pid);
    const workerClose = observed(supervisor, 'child-close', event => event.childPid === consumer.pid);
    before(producerExit, producerClose);
    before(producerClose, durable(consumer.pid, join(directory, 'consumer.receipt.json')));
    before(workerExit, workerClose);
    before(workerClose, durable(supervisor, join(directory, 'RAW-RECEIPT.json')));
    assert.equal(record.consumerState.state, 'absent');
    assert.equal(record.producerState.state, 'absent');
    assert.deepEqual(record.membersAtClose, []);
    assert.deepEqual(record.remainingGroupMembers, []);
    return { producerExit, producerClose, workerExit, workerClose };
  });
  if (['timeout', 'allocation-mutant'].includes(row.control)) check(`${row.control}: actual signal-before-pipe-close and durable producer receipt`, () => {
    const events = consumer.orderedObservation.events;
    const event = type => { const found = events.find(row => row.type === type); assert.ok(found, type); return found; };
    const stages = ['stop-request', 'signal-return', 'producer-exit', 'owned-pipe-destroy', 'producer-close', 'throw-original', 'core-settled'].map(event);
    for (let index = 1; index < stages.length; index++) before(stages[index - 1], stages[index]);
    assert.equal(event('producer-exit').pipeDestroyed, false);
    assert.equal(consumer.orderedObservation.sameFailureObject, true);
    assert.equal(producer.signal, 'SIGTERM');
    assert.equal(consumer.failure.code, row.control === 'timeout' ? 'V3_TIMEOUT' : 'V3_RSS_LIMIT');
    assert.equal(record.forwardedFailureMessage, `CONTROL_BOUNDARY:${consumer.failure.code}`);
    const signal = observed(consumer.pid, 'child-kill-before', event => event.childPid === producer.pid && event.signal === 'SIGTERM');
    before(signal, event('producer-exit'));
    before(durable(producer.pid, join(directory, 'producer.samples.jsonl')), signal);
    const selfSignal = observed(producer.pid, 'process-kill-before', event => event.target === producer.pid && event.signal === 'SIGTERM');
    before(durable(producer.pid, join(directory, 'producer.receipt.json')), selfSignal);
    return { stages, producerSignal: signal, producerSelfSignal: selfSignal };
  });
  if (row.control === 'allocation-mutant') check('allocation: meaningful boundary and durable receipts before actual worker kill', () => {
    const boundary = record.resourceBoundary;
    assert.ok(boundary.memory.rss >= 268435456 && boundary.memory.rss < 268435456 + 67108864);
    assert.ok(consumer.mutation.steps > 1 && consumer.mutation.steps <= 40);
    assert.equal(consumer.mutation.retainedBytes, consumer.mutation.steps * 8388608);
    assert.equal(consumer.mutation.touchedByte, 180);
    assert.ok(consumer.memory.fieldwisePeaks.external > consumer.memory.baseline.external + consumer.mutation.retainedBytes - 8388608);
    const kill = observed(supervisor, 'child-kill-before', event => event.childPid === consumer.pid && event.signal === 'SIGTERM');
    assert.equal(kill.exitCode, null);
    assert.equal(kill.signalCode, null);
    before(durable(supervisor, join(directory, 'RESOURCE-BOUNDARY.json')), kill);
    before(durable(supervisor, join(directory, 'BEFORE-KILL.json')), kill);
    before(durable(consumer.pid, join(directory, 'consumer.receipt.json')), kill);
    before(durable(producer.pid, join(directory, 'producer.receipt.json')), kill);
    before(observed(consumer.pid, 'child-close', event => event.childPid === producer.pid), kill);
    assert.equal(observed(supervisor, 'child-kill-return', event => event.childPid === consumer.pid && event.signal === 'SIGTERM').accepted, true);
    assert.equal(record.signal, 'SIGTERM');
    assert.equal(record.code, null);
    assert.equal(readJson(join(directory, 'BEFORE-KILL.json')).producerState.state, 'absent');
    return { boundaryRss: boundary.memory.rss, threshold: 268435456, crossingBytes: boundary.memory.rss - 268435456, kill };
  });
  if (row.control === 'consumer-failure') check('consumer failure: saved exact structured terminal evidence', () => {
    const terminal = readJson(join(directory, 'TERMINAL-PREDICATE.json'));
    assert.equal(terminal.accepted, true);
    assert.equal(consumer.failure.code, 'V3_CONSUMER_FAILURE');
    assert.equal(consumer.consumerObservation.sameFailureObject, true);
    if (terminal.terminal === 'exit1/EPIPE') {
      assert.equal(producer.uncaught.error.code, 'EPIPE');
      assert.equal(producer.uncaught.error.syscall, 'write');
      assert.equal(producer.uncaught.error.errno, -32);
      assert.equal(producer.uncaught.stdoutErrorSameObject, true);
    } else assert.equal(terminal.terminal, 'SIGTERM');
    return terminal;
  });
}
check('final settlement after all owned children closed and all groups empty', () => {
  const probe = readJson(join(raw, 'FINAL-PROCESS-PROBE.json'));
  assert.deepEqual(probe.members, []);
  assert.equal(probe.subjects.length, 11);
  assert.ok(probe.pidStates.every(row => row.state === 'absent'));
  assert.equal(observation.filter(row => row.type === 'spawn').length, 10);
  assert.equal(readJson(join(raw, 'SETTLED.json')).allObservedChildrenExitedAndClosed, true);
  return probe;
});
const result = { at: new Date().toISOString(), mode: 'read-only postcheck; no control rerun or imported predicate rescore', checks, passed: checks.filter(row => row.passed).length, failed: checks.filter(row => !row.passed).length, measurements, exactExecution: { declared: 5, actual: summary.controlsExecuted, expected: summary.expectedOutcomes, unexpected: summary.unexpectedFailures, unrun: summary.unexecuted }, qualification: 'Fresh-process stream component only; observer overhead included. File fsync completion is observed, not directory durability or power-loss proof. Static-only author controls do not count as independently executed.' };
const descriptor = openSync(join(raw, 'READ-ONLY-POSTCHECK.json'), 'wx');
try { writeSync(descriptor, `${JSON.stringify(result, null, 2)}\n`); fsyncSync(descriptor); }
finally { closeSync(descriptor); }
console.log(JSON.stringify({ passed: result.passed, failed: result.failed, exactExecution: result.exactExecution, measurements: measurements.map(row => ({ control: row.control, baseline: row.consumerMemory.baseline.rss, peak: row.consumerMemory.fieldwisePeaks.rss, boundary: row.resourceBoundary?.memory.rss ?? null, steps: row.mutation.steps, consumerTerminal: row.consumerTerminal, producerTerminal: row.producerTerminal, forwardedCode: row.forwardedCode })) }, null, 2));
process.exitCode = result.failed ? 1 : 0;

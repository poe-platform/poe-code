import assert from 'node:assert/strict';
import { join } from 'node:path';
import { atomicWrite } from './integrity.mjs';

export function assertCapture(receipt, job, evidence, catalogue) {
  assert.equal(receipt.outcome, 'CAPTURED');
  const capture = receipt.capture;
  assert(capture && typeof capture === 'object');
  for (const name of ['stdoutHex', 'stderrHex']) assert(typeof capture[name] === 'string' && /^(?:[0-9a-f]{2})*$/.test(capture[name]), 'Malformed captured bytes');
  const stdout = Buffer.from(capture.stdoutHex, 'hex');
  const stderr = Buffer.from(capture.stderrHex, 'hex');
  atomicWrite(join(evidence, 'command-stdout.bin'), stdout);
  atomicWrite(join(evidence, 'command-stderr.bin'), stderr);

  const expected = job.expected;
  const unfulfilled = [];
  const supported = new Set(['status', 'stdoutHex', 'stdoutUtf8', 'reads', 'documents', 'diagnosticCode', 'effectProfile', 'assertions']);
  assert(expected && typeof expected === 'object' && !Array.isArray(expected), 'Malformed expectations');
  for (const key of Object.keys(expected)) {
    if (!supported.has(key)) unfulfilled.push({ path: 'expected.' + key, value: expected[key], reason: 'No assertion adapter bound' });
  }
  if (Object.hasOwn(expected, 'assertions')) {
    if (!Array.isArray(expected.assertions)) unfulfilled.push({ path: 'expected.assertions', value: expected.assertions, reason: 'Malformed assertion obligations' });
    else for (const [index, value] of expected.assertions.entries()) unfulfilled.push({ path: 'expected.assertions[' + index + ']', value, reason: 'Natural-language obligation has no executable proof binding' });
  }
  if (Object.hasOwn(expected, 'documents') && !(Array.isArray(expected.documents) && job.argv.includes('json') && job.argv.includes('-c') && !job.argv.includes('-r'))) unfulfilled.push({ path: 'expected.documents', value: expected.documents, reason: 'JSON document projection not applicable' });
  if (Object.hasOwn(expected, 'effectProfile') && !['information', 'cli-rejection', 'compile-rejection'].includes(expected.effectProfile)) unfulfilled.push({ path: 'expected.effectProfile', value: expected.effectProfile, reason: 'Unknown effect profile' });
  if (Object.hasOwn(expected, 'reads') && !Array.isArray(expected.reads)) unfulfilled.push({ path: 'expected.reads', value: expected.reads, reason: 'Malformed read obligation' });
  if (Object.hasOwn(expected, 'diagnosticCode') && (typeof expected.diagnosticCode !== 'string' || !expected.diagnosticCode)) unfulfilled.push({ path: 'expected.diagnosticCode', value: expected.diagnosticCode, reason: 'Malformed diagnostic obligation' });
  for (const key of ['stdoutHex', 'stdoutUtf8']) if (Object.hasOwn(expected, key) && typeof expected[key] !== 'string') unfulfilled.push({ path: 'expected.' + key, reason: 'Malformed byte obligation' });
  if (Object.hasOwn(job, 'missingBindings') && !Array.isArray(job.missingBindings)) unfulfilled.push({ path: 'missingBindings', reason: 'Malformed missing bindings' });
  else for (const value of job.missingBindings ?? []) unfulfilled.push({ path: 'missingBindings', value, reason: 'Frozen missing proof binding' });
  if (job.fullRecordEligibleAfterProjection === false) unfulfilled.push({ path: 'fullRecordEligibleAfterProjection', value: false, reason: 'Frozen partial record remains incomplete' });
  atomicWrite(join(evidence, 'obligations.json'), JSON.stringify({ schemaVersion: 2, status: unfulfilled.length ? 'INCOMPLETE' : 'BOUND_PROJECTION_ONLY', unfulfilled, semanticFullRecordPass: false }) + '\n');
  assert.equal(unfulfilled.length, 0, 'UNFULFILLED_OBLIGATIONS: see obligations.json; no full-record or semantic PASS');
  assert(Number.isSafeInteger(expected.status) && expected.status >= 0 && expected.status <= 255, 'Missing or malformed status obligation');
  assert.equal(capture.rejected, false, `Unexpected raw rejection: ${JSON.stringify(capture.rejection)}`);
  assert.deepEqual(capture.cleanupErrors, []);
  assert.equal(capture.status, job.expected.status);
  assert.deepEqual(capture.effects.after, capture.effects.before, 'Read-only namespace/bytes');
  assert(!capture.events.some((event) => event.kind === 'unbound-fs-operation'), 'Unexpected VFS operation');
  const reads = capture.events.filter((event) => event.kind === 'fs-read');
  assert(reads.every((event) => event.signalIsContext), 'VFS read signal not forwarded');
  if (job.expected.reads) assert.deepEqual(reads.map((event) => event.path), job.expected.reads);
  if (job.expected.stdoutHex !== undefined) assert.equal(capture.stdoutHex, job.expected.stdoutHex);
  if (job.expected.stdoutUtf8 !== undefined) assert.deepEqual(stdout, Buffer.from(job.expected.stdoutUtf8));
  if (job.expected.status === 0) assert.equal(stderr.length, 0, 'Unexpected success stderr');
  if (job.expected.documents && job.argv.includes('json') && job.argv.includes('-c') && !job.argv.includes('-r')) {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(stdout);
    assert(text.endsWith('\n'));
    assert.deepEqual(text.slice(0, -1).split('\n').map((line) => JSON.parse(line)), job.expected.documents);
  }
  if (job.expected.diagnosticCode) {
    const diagnostic = catalogue.find((entry) => entry.code === job.expected.diagnosticCode);
    assert(diagnostic, 'Unbound diagnostic');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(stderr);
    const prefix = `yq: ${diagnostic.category}: ${diagnostic.code}`;
    assert(text === `${prefix}\n` || (text.startsWith(`${prefix} at `) && text.endsWith('\n') && text.indexOf('\n') === text.length - 1), 'Exact diagnostic category/code/frame');
    if (text !== `${prefix}\n`) {
      const location = text.slice(prefix.length + 4, -1);
      const match = /^(<stdin>|"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*")(?::([1-9][0-9]*):([1-9][0-9]*))?$/u.exec(location);
      assert(match, 'Malformed diagnostic source/coordinates');
      const source = match[1];
      if (source !== '<stdin>') {
        assert(Buffer.byteLength(source) <= 256, 'Displayed filename cap');
        const filename = JSON.parse(source);
        assert(job.files.some((file) => file.path === filename), 'Diagnostic source is not a literal fixture operand');
      }
      if (match[2]) assert(['input', 'schema', 'alias'].includes(diagnostic.category), 'Opaque query/VFS/encoder error cannot invent coordinates');
    }
  }
  if (['information', 'cli-rejection', 'compile-rejection'].includes(job.expected.effectProfile)) {
    assert.equal(reads.length, 0, 'Pre-input path read a VFS operand');
    assert(!capture.events.some((event) => event.kind === 'iterator-acquire'), 'Pre-input path acquired stdin');
    if (job.expected.effectProfile !== 'information') assert.equal(stdout.length, 0, 'Pre-input rejection published stdout');
  }
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const hash = value => createHash('sha256').update(value).digest('hex');

export function assertAdequateDiagnostic(fullText, actualHex) {
  assert.equal(actualHex, Buffer.from(fullText).toString('hex'), 'adequate caps require the exact identifying diagnostic');
}

export function assertConditional(profile, spec, receipt) {
  const sealed = profile.cases.find(item => item.id === spec.id);
  assert.deepEqual(spec, sealed, 'only exact presealed case');
  assert.deepEqual(receipt.binding, {
    candidate: profile.candidate,
    base: profile.base,
    inventory: profile.inventory,
    package: profile.package,
    sourceBinding: profile.sourceBinding,
    profile: profile.version,
    caseSha256: hash(JSON.stringify(spec)),
    argv: spec.argv,
    inputHex: spec.inputHex,
    factory: { limits: spec.overrides },
    caps: { ...profile.defaults, ...spec.overrides },
    parentShellOutputLimit: null,
    collectingCap: 65536,
  }, 'candidate/input/caps/path identity');
  assert.equal(receipt.evidenceKind, 'PUBLIC_OBSERVATIONS_PLUS_STATIC_PATH_NOT_MEASURED_COUNTERS');
  assert.deepEqual(receipt.staticPath, spec.staticPath, 'bound primary failure and diagnostic path');
  assert.equal(receipt.instrumentedCounters, false, 'no invented instrumentation');
  assert.deepEqual(receipt.observation, spec.expected, 'exact boundary, bytes, reason identity and cleanup');
  assert.equal(receipt.invocations, 1, 'one invocation, no retry');
  assert.equal(receipt.admissionBeforeAcquisition, true);
  assert.equal(receipt.closed, true);
  assert.equal(receipt.intact, true);
  assert.equal(receipt.rawBeforeAssertion, true);
  const stdout = Buffer.from(receipt.observation.stdoutHex, 'hex');
  const stderr = Buffer.from(receipt.observation.stderrHex, 'hex');
  assert.equal(stdout.toString('hex'), receipt.observation.stdoutHex);
  assert.equal(stderr.toString('hex'), receipt.observation.stderrHex);
  if (spec.id.startsWith('F11-AMPLE-')) assertAdequateDiagnostic(`xan count: ${spec.staticPath.primary} limit exceeded\n`, receipt.observation.stderrHex);
  const caps = receipt.binding.caps;
  assert.ok(stdout.length + stderr.length <= caps.maxOutputBytes);
  if (spec.staticPath.ledger) {
    const ledger = spec.staticPath.ledger;
    assert.ok(ledger.finalWork <= caps.maxWork);
    assert.ok(ledger.peakRetained <= caps.maxRetainedBytes);
    assert.equal(ledger.finalRetained, 0);
    assert.ok(ledger.reservedOutput <= caps.maxOutputBytes);
    assert.ok(stdout.length + stderr.length <= ledger.reservedOutput);
    assert.equal(ledger.outputReservationsRefunded, false);
  }
  return { classification: 'CONDITIONAL_RECEIPT_ACCEPTED_NOT_PRODUCT_EXECUTION', id: spec.id };
}

export function fixtureReceipt(profile, spec) {
  return {
    binding: {
      candidate: profile.candidate, base: profile.base, inventory: profile.inventory,
      package: profile.package, sourceBinding: profile.sourceBinding, profile: profile.version,
      caseSha256: hash(JSON.stringify(spec)), argv: spec.argv, inputHex: spec.inputHex,
      factory: { limits: spec.overrides }, caps: { ...profile.defaults, ...spec.overrides },
      parentShellOutputLimit: null, collectingCap: 65536,
    },
    evidenceKind: 'PUBLIC_OBSERVATIONS_PLUS_STATIC_PATH_NOT_MEASURED_COUNTERS',
    staticPath: spec.staticPath, instrumentedCounters: false, observation: spec.expected,
    invocations: 1, admissionBeforeAcquisition: true, closed: true, intact: true,
    rawBeforeAssertion: true,
  };
}

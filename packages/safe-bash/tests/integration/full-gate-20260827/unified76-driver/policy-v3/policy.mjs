import assert from 'node:assert/strict';

export const PRODUCT = '2ffcb23d6029250c48950030120ed0adad2e5769';
export const BOUNDS = Object.freeze({
  archiveEntries: 37397,
  archiveBytes: 2382440287,
  archiveTransferBytes: 3 * 1024 * 1024 * 1024,
  historyTransferBytes: 8 * 1024 * 1024 * 1024,
  dependencyBytes: 1024 * 1024 * 1024,
  setupStderrBytes: 1024 * 1024,
  phaseOutputBytes: 256 * 1024 * 1024,
  allPhaseOutputBytes: 4 * 1024 * 1024 * 1024,
  setupTimeoutMs: 600000,
  phaseTimeoutMs: 1800000,
  cleanupTimeoutMs: 5000,
  chunkBytes: 64 * 1024,
  maximumLineBytes: 1024 * 1024,
});

export const PHASES = Object.freeze([
  ['safejs-availability', 0], ['cold-typecheck', 78], ['typecheck-all', 0],
  ['benchmark-types', 0], ['env-source-binding', 0], ['canonical', 0],
  ['current-consumers', 0], ['pack', 0], ['public-runtime', 0],
  ['public-types', 0], ['negative-types', 2], ['missing-root', 1],
  ['missing-contracts', 1], ['final-sweep', 0],
].map(entry => Object.freeze(entry)));

export function parseArgs(args) {
  assert.ok(args.length === 3 || args.length === 7, 'Explicit --candidate with --inspect or --run/output/--release/receipt/--committed-archive required');
  assert.equal(args[0], '--candidate');
  assert.equal(args[1], PRODUCT);
  if (args.length === 3) {
    assert.equal(args[2], '--inspect');
    return Object.freeze({ candidate: PRODUCT, execute: false });
  }
  assert.equal(args[2], '--run');
  assert.equal(args[4], '--release');
  assert.equal(args[6], '--committed-archive');
  assert.match(args[3], /^\/tmp\/full-gate-unified76-[A-Za-z0-9_-]+$/u);
  assert.ok(typeof args[5] === 'string' && args[5].startsWith('/') && !args[5].includes('\0'));
  return Object.freeze({ candidate: PRODUCT, execute: true, output: args[3], release: args[5] });
}

export function validateBounds(bounds, archive) {
  assert.deepEqual(bounds, BOUNDS, 'Bounds must match the reviewed finite profile');
  for (const value of Object.values(bounds)) assert.ok(Number.isSafeInteger(value) && value > 0);
  assert.equal(archive.entries, bounds.archiveEntries);
  assert.equal(archive.bytes, bounds.archiveBytes);
  assert.ok(archive.bytes < bounds.archiveTransferBytes);
}

export function enforceCharge(current, addition, maximum) {
  assert.ok(Number.isSafeInteger(current) && current >= 0);
  assert.ok(Number.isSafeInteger(addition) && addition >= 0);
  assert.ok(Number.isSafeInteger(maximum) && maximum >= 0);
  assert.ok(current <= maximum && addition <= maximum - current, 'Profile resource bound exceeded before growth');
  return current + addition;
}

export function gateVerdict(report) {
  const problems = [];
  if (report.candidate !== PRODUCT) problems.push('wrong candidate');
  if (report.bindingComplete !== true) problems.push('missing source/tool/dependency/package binding');
  if (report.guardsPassed !== true) problems.push('guard failure or missing final sweep');
  if (report.driverProductionBuilds !== 1) problems.push('expected exactly one driver-managed production build');
  if (report.cleanupComplete !== true) problems.push('cleanup incomplete');
  if (!Array.isArray(report.phases) || report.phases.length !== PHASES.length) problems.push('missing or extra phase');
  for (const [index, [name, expectedStatus]] of PHASES.entries()) {
    const phase = report.phases?.[index];
    if (!phase || phase.label !== name || phase.status !== expectedStatus) problems.push(`unexpected phase outcome: ${name}`);
    if (name !== 'final-sweep' && (!phase || phase.clean !== true || phase.closed !== true
      || phase.signal != null || phase.timedOut || phase.outputExceeded || phase.spawnError
      || phase.observerError || !Array.isArray(phase.survivors) || phase.survivors.length
      || !Array.isArray(phase.signals) || phase.signals.length)) problems.push(`unclean process lifecycle: ${name}`);
  }
  const tap = report.canonical;
  if (!tap || tap.reconciled !== true || !Number.isSafeInteger(tap.counts?.pass) || tap.counts.pass < 1) problems.push('incomplete canonical TAP');
  for (const name of ['fail', 'skipped', 'todo', 'cancelled']) if (tap?.counts?.[name] !== 0) problems.push(`canonical ${name} is nonzero or missing`);
  if (report.canonicalMissingPaths?.length !== 0) problems.push('missing canonical execution coverage');
  return Object.freeze({ status: problems.length ? 'HOLD_OR_QUALIFIED_RED' : 'QUALIFIED_ZERO_SKIP_GATE', exitCode: problems.length ? 1 : 0, problems });
}

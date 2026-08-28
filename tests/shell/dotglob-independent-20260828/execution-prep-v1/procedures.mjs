import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { digestFile } from './admission.mjs';
import { cases } from './plan.mjs';

export const checkpoints = Object.freeze({
  R01: ['call-time-off-on-off'],
  R02: ['same-shell-new-exec', 'overlapping-isolated-shells'],
  R03: ['virtual-environment-does-not-enable', 'replacement-retains-clone-state'],
  R04: ['each-pipeline-stage-inherits', 'stage-mutation-isolated'],
  R05: ['invoke-clone', 'literal-argv', 'nul-and-type-admission', 'shared-options-signal-budget'],
  R06: ['scriptFile-whole-input-preflight', 'late-syntax-no-leading-effects'],
  R07: ['bound-interpreter-entry-routes-fresh', 'source-eval-share', 'subshell-substitution-clone'],
  R08: ['discovery', 'registry-collision', 'function-precedence-command-bypass', 'default-inventory-unchanged'],
  R09: ['errexit-named-disabled', 'guarded-control-status', 'no-name-zero', 'invalid-flag-two'],
  R10: ['ordered-channel-events', 'duplicates', 'valid-unknown-order-no-rollback', 'gated-diagnostics'],
  R11: ['invalid-before-conflict-before-operands', 'later-flag-is-name', 'no-vfs-access'],
  R12: ['all-eight-reason-identities', 'no-preabort-dispatch'],
  R13: ['readdir-abort', 'stat-abort', 'propagated-signal-no-successful-late-effects'],
  R14: ['actual-pattern-checkpoint-hit', 'caller-reason-identity', 'bounded-fixture'],
  R15: ['off-five-allow-four-reject', 'on-nine-allow-eight-reject', 'typed-field-limit-before-dispatch'],
  R16: ['off-fourteen-thirteen', 'on-thirtyone-thirty', 'typed-byte-limit-before-dispatch'],
  R17: ['ordinary-and-reusable-byte-boundaries', 'silent-zero-cap', 'diagnostic-zero-cap-limit'],
  R18: ['bound-work-positive', 'bound-work-exhaustion', 'off-controls-accounting-retained'],
  R19: ['nested-shared-command-limit', 'source-depth-loop-limits', 'earlier-effects-retained'],
  R20: ['stdout-failure-stops-later-operands', 'stderr-unknown-first-no-later-mutation', 'valid-first-mutation-retained', 'base-error-mapping'],
  R21: ['stdout-stderr-backpressure', 'registered-cleanup-drained-once', 'caller-execution-cleanup-precedence', 'unawaited-child-colon-comparator-no-unhandled'],
  R22: ['provider-order-final-sort', 'custom-dot-entries', 'swallowed-vs-propagated-errno'],
  R23: ['six-offending-z-preflight-rows', 'two-later-cluster-name-neighbors'],
  R24: ['selected-source-two-file-delta', 'actual-source-installed-moved-loads', 'types-and-inversions', 'denied-source-fallback', 'guard-and-reversion-mutants', 'actual-package-late-nonzero-rejected'],
  R25: ['source-line-two', 'function-eval-diagnostics', 'redirection-and-stdin-not-consumed'],
  R26: ['literal-dot-dotdot', 'wildcard-dot-omission-both-states', 'dotdotkeep-preserved', 'configured-realfs-positive-refusal'],
});

export function validateAdapters(adapters) {
  assert.deepEqual(Object.keys(adapters).sort(), cases().procedures.map(row => row.id).sort(), 'all 26 procedures, none omitted');
  for (const [id, execute] of Object.entries(adapters)) assert.equal(typeof execute, 'function', `${id} actual executor required`);
}

export async function loadAdapters(binding, allowed) {
  assert.equal(binding.kind, 'dotglob-procedure-adapters-v1');
  assert.ok(allowed.has(binding.path), 'adapter must be in authenticated loader tree');
  digestFile(binding.path, binding.sha256);
  const module = await import(pathToFileURL(binding.path).href);
  validateAdapters(module.adapters);
  return module.adapters;
}

export async function procedureCase(adapters, row, resources, context) {
  const observations = [];
  const check = (name, actual, expected) => {
    assert.ok(checkpoints[row.id].includes(name), `unfrozen checkpoint ${row.id}/${name}`);
    assert.equal(observations.some(value => value.name === name), false, 'duplicate checkpoint');
    assert.deepEqual(actual, expected, `${row.id}/${name}`);
    observations.push({ name, actual, expected });
  };
  await adapters[row.id]({ ...context, row, resources, check });
  assert.deepEqual(observations.map(value => value.name).sort(), [...checkpoints[row.id]].sort(), 'no missing procedure checkpoints');
  return { checkpoints: observations };
}

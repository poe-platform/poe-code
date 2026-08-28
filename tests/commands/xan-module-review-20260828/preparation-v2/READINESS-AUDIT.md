# Postqualification readiness audit

Friday, August 28, 2026. Static review only, after the one sealed synthetic run.
No expectation, implementation, recipe manifest or captured result is changed.
No additional runtime qualification is performed.

## A01 — actual candidate parent is not fully phase/closure gated

At `runner.mjs:45`, the actual candidate path awaits the supervised child, then
verifies selected layout/artifact/recipe integrity. At `runner.mjs:48` it stops
only for an unreaped child. At `runner.mjs:50` it computes the public aggregate
from child exit code, overflow and timeout, without reading/authenticating the
worker's final required-phase/complete/closed record.

Consequently an early zero exit without the required phase record could be
accepted. A reaped nonzero exit also does not distinguish an ordinary, closed
assertion failure from a cleanup-break/incomplete phase before starting the next
layout. Process reaping is necessary but is not the missing cooperative-closure
or required-phase evidence.

The synthetic SOURCE and moved path in `qualify.mjs` does inspect the final
phase, completion, failures and closure fields. The generic `aggregate` helper
also rejects missing phases/failed phases/raw bounds and stops unclosed or
integrity-broken controls. The one qualification correctly exercises those
paths, but does not qualify their use in `runner.mjs`, which does not call the
generic helper. Passing controls therefore do **not** close this orchestration
gap. This is a candidate-independent implementation omission, not absent product
API information and not a normative contradiction or request for grammar policy.

## Disposition

The main case, diagnostic, resource, scenario, guard, admission and confinement
engines are implemented and the sealed cohort qualified. Full executable
preparatory readiness is nevertheless **not established** for this recipe.
PREPARATION.md's closure table must be read with A01: the G01/G04/G06 end-to-end
parent orchestration is not fully closed. No candidate should be routed through
this version's `run-candidate` as an acceptance gate.

A new explicitly authorized additive recipe must connect required-phase/closed
receipt validation to the actual candidate parent, stop dependents on an
incomplete/cleanup-broken phase, and qualify missing/failed/zero-exit-without-phase
mutants on that exact path. Preserve this recipe and its successful but scoped
qualification; do not silently patch or rerun it to claim readiness. There is no
new source inspection, product execution, native observation or policy inference
in this finding.

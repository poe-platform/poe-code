---
title: Promise subclass construction
---

## Validated gaps

Two initial regressions reproduce loss of `new.target.prototype` during Promise
allocation and missing class invocation context in inherited static methods.
Expanded native comparisons also expose inherited combinator lookup and promise
assimilation paths that dropped this context.

## Implementation

Read the construction prototype before invoking the executor and install custom
object prototypes without explicitly marking the unchanged intrinsic prototype.
Preserve invocation context and the actual construction target through capability
creation and recursive resolution. Read combinator results through ordinary
descriptor-aware property lookup.

## Validation

Use native comparisons for inherited static operations, reaction species,
multi-level subclasses and identity. Cover instance fields, species overrides,
thenable/reaction assimilation, and pending/completed public replay.
Run focused Promise and class regressions, lint/types, the maintained workspace
unit route (excluding only the separate uncommitted host-import policy tests),
the selected build, and this CLI harness with screenshot inspection.

Direct portable promise graph export and active class construction checkpoints
remain separate limitations; this change does not claim those are complete.
Push this atomic change independently and monitor publication without waiting
before investigating the next validated limitation.

Local checks passed: 209 Promise regression tests, 119 class/replay tests, lint,
types, and 16,770 maintained workspace tests (41 skips). The separate async-boundary
regression file was added after workspace collection: its two validated failures
are not included in this commit or in the passing count. Those concern async
function returns and directly awaited thenables, beyond the Promise-method paths
fixed here.

---
title: Lazy matchAll iterator
---

Validate the built-in matchAll result against native JavaScript before changing it.
The initial native comparison suite failed seven of eight cases: results were
eager arrays, with no next method, repeatable consumption, and the wrong tag.
Six direct snapshot/replay/clone cases independently lost iterator state.

Use explicit matcher, input, and exhaustion state. Clone the source cursor at
creation, execute only on next, advance empty matches, and release exhausted
state. Preserve aliases and partial consumption across checkpoints. Account for
the hidden matcher/input and enforce per-match capture and consumer array limits.

Validate native result shape, cursor isolation, empty and nonglobal scans,
method receivers and overrides, public dump data, and host-suspension resume.
Run maintained package unit tests, changed-file lint, types, selected workspace
build, and this real harness with a screenshot. No capabilities or agent spawns.

Remaining separate gaps include RegExp species/exec dispatch, full intrinsic
prototype graphs, advanced regex syntax, and portable custom accessor/prototype
state. This change does not claim those are complete.

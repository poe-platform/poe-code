---
title: Generator template continuations
---

## Validated gap

Ten native-comparison regressions failed before implementation: low-level
restoration repeated completed template substitutions and their string
conversions. Nested templates and multiple checkpoints also repeated effects.

## Change

Save the completed string prefix and current substitution index. Resume the
current substitution without reevaluating previous substitutions or coercions.
Validate prefix type and exact substitution ownership/index against the source.
Tagged templates do not use ordinary string-prefix semantics; a nested ordinary
template inside a tagged substitution still retains its own continuation.

## QA

Run `npm run screenshot-poe-code -- harness run
docs/plans/safejs-generator-template-continuations.md` and inspect the screenshot.
Expect a passed harness, zero spawns and no warnings. The pair asserts count=1
and result="0:4". It grants no external capabilities. This is CLI smoke coverage;
repeated low-level restoration is independently compared with native JavaScript
in the unit suite, not inferred from the CLI output.

## Verification

All 15,308 package tests passed (41 existing skips), including 12 sync/async
native comparisons and two malformed-continuation rejection tests. Focused
ESLint, package types and the maintained selected-workspace build passed,
including four built-import checks. The CLI harness passed with zero spawns;
its screenshot was inspected and showed no warnings or errors.

---
title: Observable matchAll clone flags
---

Validated eight native mismatches before implementation: matchAll cloned
immutable engine flags, skipped the second observable flags read, and coerced
lastIndex before clone construction. An own ignoreCase=true on /a/g must let
'A'.matchAll(regex) match uppercase input.

Read and convert clone flags before constructing the matcher, then read and
coerce lastIndex. Use internal source for a branded regex, not its overridden
source property. Preserve lazy iteration, independent cursor state, and budgets.
Release retained conversion values and compilation ownership on failures.
Keep plain-data low-level calls synchronous, including their compilation-budget
failures; only guest property reads or coercion that suspend need a Promise.
The package suite caught five regressions when this route was initially made
unconditionally async. All affected low-level and budget tests pass after
preserving synchronous completion, without changing their limits or assertions.

Additional checks cover duplicate flags and Symbol flags rejecting before cursor
coercion, and mutations to the original regex after iterator creation.

Validate with the maintained safe-js unit suite, changed-file lint, package
typecheck, selected workspace build, and this harness pair with screenshot
inspection. The harness has no capabilities and performs zero agent spawns.

Remaining separate gaps: RegExp species construction and intrinsic prototype
symbol methods, custom exec dispatch, and unsupported regex engine features.

Next validated cases: an own constructor getter returning undefined is called
between the two flags reads by native matchAll, but not by SafeJS. Also, setting
/a/.exec to a function returning null makes native 'a'.match(regex) return null;
SafeJS returns ['a']. These require separate algorithm changes.

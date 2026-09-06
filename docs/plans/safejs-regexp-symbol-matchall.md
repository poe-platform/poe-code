---
title: RegExp Symbol.matchAll, species, and lazy custom execution
---

# RegExp Symbol.matchAll, species, and lazy custom execution

## Validated baseline

The native-comparison suite `regex-symbol-matchall.test.ts` initially reports
twelve failures and one passing invalid-species exception control. It covers
explicit global and nonglobal protocol calls, metadata, the species getter,
cursor copying, constructor/flags/cursor order, custom matcher result identity,
lazy execution, nonglobal exhaustion, Unicode advancement, derived exec
overrides, and null-species fallback.

## Required implementation

Follow the [ECMAScript matchAll algorithm](https://tc39.es/ecma262/multipage/text-processing.html#sec-regexp-prototype-%symbol.matchall%).
Validate the receiver and coerce input before species lookup. Read and convert
flags, construct the matcher with the original receiver and flags, then copy
the original cursor through ToLength. Capture global and Unicode modes from
those flags; do not derive them later from a potentially unrelated matcher.
Construction occurs immediately, while exec calls remain lazy. Return the
actual execution result object, and exhaust nonglobal iteration after one hit.

Expose RegExp[Symbol.species] as a receiver-returning accessor so subclasses
inherit the default. Null or undefined species falls back to RegExp; invalid
constructors must fail at the specified point in the observable sequence.

## Runtime and persistence changes must land together

- `interp/regexp-iterator.ts` currently stores only SandboxRegex, input, and
  exhaustion. It needs a general object matcher and captured iteration modes.
- `interp/methods/regexp-iterator.ts` currently calls executeRegex directly and
  derives modes from matcher.flags. The observable route must use RegExpExec,
  safe property reads/writes, match coercion, and AdvanceStringIndex semantics.
- `interp/iteration.ts` currently special-cases these iterators with synchronous
  native stepping. For-of, spread, Array.from, and explicit next calls must all
  reach custom matcher execution without exposing host promises as results.
- Snapshot serialization/restoration, dump format, replay data, and cloning
  currently encode the narrow state or reject non-regex matchers. Extend and
  validate the format consistently; keep existing default-regex snapshots
  compatible and never silently drop custom state or captured modes.
- Preserve matcher/input/result retention, fatal budgets, lazy termination,
  independent iterator state, and cleanup when exhausted. Portable guest
  closures and prototype graphs remain a broader unfinished requirement;
  unsupported persistence must fail explicitly rather than corrupt data.

## Verification before delivery

First make the native protocol comparisons pass. Add malformed-state,
round-trip, independent-mode, iterator-consumer, and low/high-budget controls.
Run the maintained SafeJS unit route, changed-file lint, package types,
selected workspace build, and a real capability-free harness with screenshot
inspection. Commit and push the complete atomic change only after its checks
pass. Continue release monitoring independently of this implementation.

## Implemented verification evidence

Runtime comparison cases now pass, including derived exec overrides and
ordinary species-created matchers. Checkpoint replay covers both default and
custom matcher state. Snapshot, replay-data, and clone tests preserve matcher
identity and captured modes; malformed mode fields are rejected. The live
execution result remains retained during cursor getter execution under fixed
6,000-byte rejection and 14,000-byte success controls.

An exception audit corrected an initial mistaken assumption: RegExp string
iterators are not exhausted by a throwing exec. Native execution and the
[iterator next algorithm](https://tc39.es/ecma262/multipage/text-processing.html#sec-%regexpstringiteratorprototype%.next)
agree; the test now verifies repeated exceptions without premature exhaustion.
No generator-style blanket closing behavior is added.

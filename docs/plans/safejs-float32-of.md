---
title: Float32Array.of factory
---

# Validated missing typed-array factory

A read-only native/SafeJS comparison confirmed that
`Array.from(Float32Array.of(1,2.5))` returns `[1,2.5]` in an isolated native realm
and throws TypeError in current SafeJS. The prototype improvement is already on
remote main; this factory is a separate atomic change.

Use native-oracle tests for empty input, rounding, inherited factory metadata,
subclass construction, custom constructors, invalid/undersized results and
ordered guest numeric coercion. Preserve allocation and retained-value budgets,
and add portable factory/snapshot coverage before delivery.

The [ECMAScript algorithm](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-%typedarray%.of)
requires a constructor receiver, creates and validates typed storage before
writing items in order, and returns that storage. Implement through guest
construction/coercion mechanisms without exposing arbitrary host execution.

The related `from` factory and array-like constructor inputs were also reproduced
as missing. They remain subsequent work, alongside other typed arrays and buffer
APIs; this plan does not claim to close those gaps.

## Initial implementation evidence

The nine-case suite initially had six failures and three error-path controls
passing (the missing method itself can also produce TypeError, so those controls
need stronger side-effect assertions). Log: `/tmp/poe-safejs-float32-of-red.log`.
The shared TypedArray constructor now owns the inherited factory with native
metadata. It constructs through the guest call bridge, validates storage length,
converts items with sandboxNumber in order, and retains receiver/result/items
through construction and coercion. All nine focused cases and TypeScript pass.
Log: `/tmp/poe-safejs-float32-of-focused.log`.

This is unfinished local work, not committed or pushed. Next strengthen rejection
order and side-effect controls, test Symbols/BigInts and abrupt conversion,
portable factory snapshots and tight retained-value budgets. Update the older
bounded-surface test's factory expectation only after these native comparisons.
Then run appropriate package checks, build and the actual harness pair before
the separate atomic commit/push. Prototype-change releases being monitored are
CLI run 34085109173 and scoped packages run 34085109167 (head 9ffddc36c).

Expanded native comparisons validate constructor-result checking before item
coercion, abrupt coercion preserving earlier writes, Symbol/BigInt rejection,
number-hint conversion and internal length despite subclass overrides. Portable
factory identity and subclass calls survive two snapshot/restore cycles. Budget
probes verify 12KB of returned typed storage stays retained during coercion and
is released afterward, on both normal return and throw. The expanded cohort
passed 45 tests including the maintained Float32Array tests; TypeScript passed.
The full SafeJS suite is running with the usual separate host-Promise policy
audit exclusion: `/tmp/poe-safejs-float32-of-package.log`.

The snapshot probe also exposed a separate parser defect: `const of = ...` is
rejected as an unexpected token. The factory snapshot probe uses `factory` to
isolate its own contract; contextual-keyword bindings remain a validated follow-up,
not a claim that such identifiers are unsupported by JavaScript.

## Qualification

The full SafeJS suite passed 17,687 tests with 41 skips (518 passing files,
one skipped) in 243.68 seconds, with only the separate two-case host-Promise
import policy audit excluded. Scoped ESLint and TypeScript passed. The selected
build passed its 23-workspace closure and four native-ESM checks. The actual
harness passed after 70 uncached CLI build tasks (59.006 seconds); its screenshot
was opened and visually verified at
`screenshots/harness-run-docs-plans-safejs-float32-of.md.png`.

The matching open-issue search was empty. This factory is ready for its own
commit/push; remote delivery and publication must be verified separately.
The earlier prototype improvement published as @poe-platform/safe-js@0.1.308
in run 34085109167; its CLI run 34085109173 was still active at the last check.

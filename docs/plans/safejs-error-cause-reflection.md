# Error cause reflection

## Validated defect

ECMAScript InstallErrorCause requires HasProperty(options, "cause"), followed
by Get only when present. See the [normative operation](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-installerrorcause).
The current createNativeError instead uses getSandboxPropertyDescriptor, which
skips guest Proxy has traps and can omit virtual or inherited Proxy causes.
A public run probe reproduces missing has/get effects (2baacf).

## Isolated repair and evidence

While the unchanged main runtime's full test ran in session 52427, the repair
was isolated in `/tmp/safejs-error-cause.9apNMZ`. Main runtime and test edits
were held until that run terminated.

- Eleven regressions failed before the fix (dffbdc): all eight applicable
  error constructors, has/get abrupt completions, and an inherited Proxy cause
  with message/cause/iterator effect ordering.
- Replace the descriptor presence check with the existing sandboxHasProperty
  operation. Keep Get, property attributes, retention, and standalone legacy
  error construction unchanged.
- Original regressions plus existing error tests: 33 passed (e3b30a).
- Error constructors, coercion, lifetime, SuppressedError, Proxy has, private
  host causes and error snapshots: 112 passed across eight files; package
  TypeScript check passed (bd2514).
- Expanded regression file: 15 passed (20d288), adding hidden own causes,
  protected-property invariants, revoked proxies, function options and the
  ignored SuppressedError fourth argument.
- Six additional native comparisons interrupt AggregateError construction at
  prototype lookup, message conversion, has, get, iterator acquisition, or no
  step. All agree on effects and thrown-value identity; the expanded file has
  21 passing tests (0a2450).
- A similar descriptor-presence expression in array method dispatch is limited
  to admitted host objects. Guest objects already use sandboxHasProperty, so
  that source similarity is not evidence for another runtime patch.
- Expanded candidate ESLint and TypeScript checks passed (2239b6).
- Twelve public native comparisons agree on Proxy access order (cb643e): Date
  toJSON, JSON stringify, Object/Reflect descriptor conversion, Object.create,
  Array.from/includes/indexOf/slice, RegExp construction and NumberFormat/
  DateTimeFormat options. No further fix is justified by these bounded probes;
  they are not a broad conformance claim.
- A public dump/replay regression verifies that an exported Error factory
  still invokes cause traps after realm cleanup and preserves the cause's
  identity. The expanded candidate file passes all 22 tests (5d9b25).
- Three borrowed-constructor checks preserve caller cause/error identity when
  has throws, get throws, or construction succeeds. All 25 candidate tests
  pass (4ef015). Expanded replay-test lint passed (38e7e2).
- Pinned Test262 `test/built-ins/Error` top-level strict-source selection at
  72faf8ec1445c55149615e8b35187830783aba1a: 14 native/guest passes, one skipped
  `$262` realm-adapter test and one Script-context mismatch (e1a45e).
  `prop-desc.js` calls verifyProperty(this, "Error", ...); top-level this is
  not a Script global in SafeJS's module execution. The initial uncaught probe
  stopped on this case (8dc420); the per-case rerun records it explicitly, not
  as a conformance pass or a validated Error constructor defect.
  A direct main-runtime globalThis descriptor control passes: Error identity,
  writable true, enumerable false, configurable true (f6c3b1). The mismatch
  therefore does not justify changing that global descriptor.
- The corresponding pinned AggregateError directory selection has 17 native/
  guest passes, one `$262` exclusion and one top-level-this Script-context
  mismatch (ecc2e2), including iterable failures and argument evaluation order.
  Inspecting its prop-desc.js confirms the same Script assumption; direct
  globalThis descriptor/identity validation passes on main (319fbf).
- Final candidate ESLint passes (d9a004). Ten additional native boundary
  comparisons match (5ead02): undefined/null/number/string/symbol/boolean
  options, inherited undefined cause, falsy/truthy has results and a hidden
  cause on a non-extensible target.

## Main integration

The full run 52427 completed with 28,379 passes, 14 failures and 47 skips;
see the integration record. Only after it terminated were the new regression
file and repair applied on main. Main red: 22 failed, three passing controls
(70492e). The implementation matches the isolated two-line change.
Package README and the current gap inventory are updated.
Main selected verification passes 148 tests across nine files (a21341),
including all 25 regressions and error, Proxy, host privacy and snapshot
controls. Main diff whitespace checks pass (33e3c3).
Main ESLint and package TypeScript checks pass (ac9c2c).

## Remaining delivery steps

Main scoped tests/lint/type checks are complete; commit the repair atomically.
Push and release remain on hold. This is runtime behavior only; no
visual CLI surface changes or screenshot validation apply.

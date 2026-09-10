# String.raw direct conversion repair

## Validated defect

At b52e94813, the interpreter-context path used guest conversions, but direct
intrinsic calls used host `String` and required `raw` to be a real array.
Six initial regressions failed: Symbol raw entries, Symbol substitutions,
array-like raw objects, primitive raw strings, inherited guest `raw`, and
guest `toString` closures. The red run is 771668. Its seventh budget case
mistakenly used an unsupported `steps` option; that failure is not counted as
valid budget evidence. The test now uses `maxSteps`.

The [String.raw algorithm](https://tc39.es/ecma262/multipage/text-processing.html#sec-string.raw)
requires object conversion of the template and raw value, a single length
conversion, and ordered string conversion of entries and needed substitutions.
This also makes boxed receiver identity observable through primitive-prototype
getters; the shared implementation now preserves it in interpreter calls.

## Repair

Replace the separate host-coercion fallback with one asynchronous implementation.
Use interpreter property reads when available and sandbox property reads otherwise.
Box primitive template/raw values, retain inputs and accumulated output during
conversion, capture length once, and charge each iteration and produced string.
Keep abrupt completion and ignored extra substitutions intact. Remove the
array-only helper. Direct calls now return a promise, including validation errors;
the existing direct-call test was updated to await rejection.

## Verification

- 25 tests in `string-raw-direct.test.ts` cover the six reproduced defects,
  length conversion, budget exhaustion/cleanup, abrupt guest coercion, Proxy read
  order, primitive boxing, mutation after length capture, job order, and replay.
- Native VM execution independently supplies expected results for eight guest
  programs; direct primitive length cases compare against native `String.raw`.
- Focused run e28e58: 154 tests passed across six files (new regressions,
  object-array, string factories, template coercion/identity/freezing).
- Scoped ESLint passed (26e1d1); package TypeScript `--noEmit` passed (f63097).
- This is not a new full-package gate. The ISO and Promise failures remain open.

No visual CLI change, so screenshots are not applicable. README updated with
the authorized behavior summary. Commit remains local under the release hold.

## ISO integration follow-up

Current `interp/intl-datetimeformat.ts` uses captured native formatting for
numeric input and `temporal-polyfill/full/implementation` for Temporal inputs.
Temporal locale methods separately call backend value methods. The installed
backend captures `RawDateTimeFormat` and constructs its own per-type formatters;
replacing only the guest Intl constructor cannot fix Temporal locale methods.
Any package-owned ISO formatter must cover these consumers without mutating
global Intl, node_modules, or the user's runtime. This inspection does not
constitute an ISO repair or justify changing calendar semantics.

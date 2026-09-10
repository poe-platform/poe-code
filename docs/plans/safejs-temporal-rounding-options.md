# Shared Temporal rounding option conversion

PlainTime and PlainDateTime need the same ordered increment/mode/unit reads,
with different allowed units. Extract their option normalization into a typed
reader; callers still enforce their own increment divisibility and rounding.
Instant's distinct rounding arithmetic and increment limits are unchanged.

The pinned upstream PlainDateTime round corpus exposed four failures (0348a6)
in two missing-smallestUnit fixtures, both script modes. The original reader
and local tests incorrectly required TypeError for an empty options object.
Temporal's required-unit option instead requires RangeError. Corrected local
expectations failed in both PlainTime and PlainDateTime (6a191b); changing the
reader to RangeError passed all 62 rounding tests (0055f0).

Specification: https://tc39.es/proposal-temporal/#sec-temporal-gettemporalunitvaluedoption

The reader and its direct tests form an independent local commit. Public
Temporal integration and its end-to-end tests remain separate uncommitted work.
No push or release while the release hold remains in effect.

Nine direct option-reader tests passed (c6ac1f), including operation-selected
units, normalization, missing-unit RangeError, and wrong-type TypeError.
The maintained build passed 23 tasks and five import checks (e4c482).
Both upstream regressions passed both script modes against that build (154c86).
Scoped reader/test lint passed (217b28), and Node 18.18.2 passed all 71 direct
and end-to-end rounding tests (ae5da3).

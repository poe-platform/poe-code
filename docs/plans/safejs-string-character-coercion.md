# String character index coercion

## Validated defect

Current-code native comparisons found 40 failures among 48 cases for at,
charAt, charCodeAt and codePointAt (e1d029). Numeric guest hooks were bypassed,
throwing conversions lost their original values, and callable indexes or
ignored callable extra arguments were incorrectly rejected.

## Repair

These four methods now share repeat's guest numeric-conversion path. Receiver
conversion remains first; primitive numeric conversion stays synchronous.
Object conversion retains receiver and arguments until completion. Native
character operations still determine truncation, negative/out-of-range index
behavior, UTF-16 code units and full code points. Only string results are
charged as allocated strings; numeric and undefined results remain unchanged.

## Verification

The initial character regression, repeat regression and existing string-method
suite passed 90 tests (a3fa97). Expanded coverage adds pending/completed
checkpoints and direct method calls without interpreter context for all four
methods. Native comparisons include surrogate pairs, fractional/negative/NaN
and infinite indexes, Symbol/BigInt rejection, conversion order and errors.
The final five-file selection passed 111 tests, including all 54 character
regressions (140bae). Targeted ESLint and package TypeScript checks passed
(56c330); the final expanded regression passed lint again (4e20bc).

No CLI visual behavior changes, push or release. The prior full-package result
does not cover this repair and its 14 ISO/Temporal/Promise failures remain open.

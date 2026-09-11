# Blank Duration totals at PlainDate boundaries

## Reproduction and normative basis

`new Temporal.Duration().total({relativeTo, unit})` threw for valid PlainDate
boundaries `-271821-04-19` and `+275760-09-13`. The regression covers positive
zero for year, month, week, day, hour and nanosecond totals. The original
implementation unnecessarily constructed a midnight PlainDateTime or the next
calendar interval, which can fall outside the representable range.

[DifferencePlainDateTimeWithTotal](https://tc39.es/proposal-temporal/#sec-temporal-differenceplaindatetimewithtotal)
returns zero for equal endpoints before checking date-time limits. Native
Node 26.8.1 independently returned positive zero for all twelve plain-date
combinations (2e2524).

Do not generalize this shortcut to ZonedDateTime: its total algorithm differs.
The initial exploratory zoned-boundary case also throws natively and was removed
from the accepted-value regression before implementation. Exact nonzero calendar
totals near the boundary may also legitimately require an out-of-range rounding
interval; no change to those cases is claimed.

## Change

Validate the relative input and requested unit first. For a blank duration with
a validated PlainDate relative input, return positive zero before constructing
date-times or calendar intervals. Preserve missing-relative-date errors for
calendar units and invalid-unit/invalid-relative-input errors.

The existing total adapter and its exact-rational, DST, option-order and replay
tests were pending integration; include them with this fix. Public Temporal
namespace and snapshot wiring remain unfinished, so current-tree tests are not
standalone HEAD or release qualification.

## Validation

The final pre-fix plain-date regression had two failures and one passing
validation-control test (475b46). An initial post-fix cohort passed 67 tests,
but TypeScript caught lost unit narrowing; unit normalization was adjusted to
retain literal types before the final checks.

- Final focused total/relative-date cohort: 67 passed across 6 files (ecaf63).
- Node 18.20.8: 3 regression tests passed, including all twelve boundary/unit
  combinations and invalid-option controls (b29284).
- Final package TypeScript check passed (0f6f01).
- ESLint on both test files and the initial adapter change passed (884ff6).
- ESLint on the final adapter passed (7ffc0b).

No release or push is authorized. This change has no visual CLI impact and does
not resolve the outstanding full-package test failures.

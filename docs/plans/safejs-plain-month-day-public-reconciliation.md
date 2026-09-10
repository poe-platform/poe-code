# PlainMonthDay public integration reconciliation

## Scope

Commit the pending constructor/method factory and five remaining public test
files. Input conversion and the YearMonth calendar repair were committed in
`106adda66`; PlainDate cross-conversion tests were committed earlier.
This change reconciles existing local implementation, not a new locale repair.

Reviewed constructor coercion/validation before new-target prototype selection,
private getters, calendar-aware year conversion, input normalization, equality
including reference year, formatting options, locale handling, receiver brands,
result prototypes and intrinsic registration.

## Verification

The identical eight-file MonthDay cohort, including calendar-input regression
tests, was run without skips on three installed Node versions:

| Runtime | Passed | Failed |
| --- | ---: | ---: |
| Node 22.23.2 | 62 | 3 |
| Node 18.20.8 | 65 | 0 |
| Node 26.8.1 | 65 | 0 |

All three failures are the ISO long-month locale cases using UTC, Honolulu and
+05:30. Node 22 returns ` 29` instead of `February 29`. Direct native Intl
formatting also omits the month on Node 22, while Node 26 returns it. The tests
are retained unchanged; no assertion is weakened, no default runtime changed,
and no Gregorian substitution introduced.

The direct probes report ICU 78.2 on Node 22.23.2 and ICU 78.3 on Node 26.8.1.
Package TypeScript checking with `--noEmit` passed.
Focused ESLint passed for the factory and five newly committed test files.

Named-property metadata matches native Node 26.8.1 for all four constructor
properties and eleven prototype properties, including descriptors and function
names/lengths. Coverage also exercises construction, getters, formatting,
partial input guards, calendar conversion, subclassing and completed replay.

## Remaining work

The ISO locale defect is still open under `safejs-iso-locale-month-data.md`.
Node 18/26 successes do not make the Node 22 route green or resolve the package
full-gate failures. Public Temporal namespace and snapshot integration remain
partly uncommitted, so working-tree results are not standalone HEAD validation.

No visual CLI change. Commit locally with explicit incomplete status; do not
push, publish, close issues or claim the SafeJS goal complete.

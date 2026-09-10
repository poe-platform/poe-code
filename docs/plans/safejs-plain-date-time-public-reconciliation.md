# PlainDateTime public integration

## Scope

Commit the reviewed PlainDateTime constructor/method factory, input reader,
arithmetic adapter and sixteen focused public test files. The shared Duration,
PlainTime, calendar, difference, rounding and string-option dependencies are
already committed. Temporal namespace and snapshot wiring remain separate.

Reviewed private numeric/calendar fields, constructor coercion and validation,
from/with, comparison/equality, differences, arithmetic, date/time/zoned
conversions, calendar/time replacement, rounding, string/JSON/locale formatting
and original-realm result prototypes. Expanded-year string parsing deliberately
separates syntax/calendar errors from range validation after overflow reads.

Added four regressions for ZonedDateTime private local-date/time/calendar
conversion before overflow access, and partial-input rejection of owned
MonthDay/YearMonth/ZonedDateTime before public accessors. Removed a stale comment
requesting date/time brands already handled. No new runtime defect was
demonstrated during this reconciliation, so no algorithm was speculatively changed.

## Verification

Before editing, the maintained command
`npm run build:workspaces -- --workspace=@poe-code/safe-js` completed successfully:
23 build tasks, including SafeJS compilation and five fresh native-ESM import
checks (1c5e10). Its task graph reported 71 workspaces, 211 edges and 11 layers.
Runtime logic was unchanged afterward; only the stale comment and tests changed.

The final current-tree PlainDateTime cohort passed 198 tests across 19 files
(e8cc00). It includes transport/snapshot and related input tests outside this
commit; these results do not establish standalone committed-tree conformance.

A Node 26.8.1 native/guest probe matched the five constructor and thirty-nine
prototype own string properties, descriptor flags and method/getter metadata
(42700a). A separate native probe confirmed the exact private-field conversion
result, including nanoseconds and the Buddhist calendar (df937a). Metadata
parity does not prove semantics; symbol keys were not part of that comparison.

Node 18.20.8 also passed all 198 tests across the same 19 files (f80b32).
Focused ESLint on the three implementation files and sixteen public test files
passed (4faeb9).

## Still open

The full-package gate remains non-green. Intl extreme ranges/locale portability,
skipped-day arithmetic and the other recorded JavaScript limitations remain
unresolved. Public Temporal namespace and snapshot integration are still partly
uncommitted. There is no visual CLI change, push or release in this work.

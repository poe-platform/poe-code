# String repeat count conversion

## Validated defect

The earlier Test262 qualification recorded repeat's
`return-abrupt-from-count.js` failure in safejs-string-search-coercion.md.
An independent native-comparison regression in the current checkout failed
10 of 13 cases before the repair (46fd7d). Guest count valueOf/toString and
Symbol.toPrimitive hooks were not called; the blanket callable-argument
rejection also rejected valid count objects and ignored extra arguments.

## Repair

Repeat now converts its first argument with sandboxNumber before native repeat.
Receiver conversion remains first. Primitive count conversion remains
synchronous; asynchronous guest conversion retains the receiver and arguments
until completion. Native repeat still applies integer truncation and range
validation, and budget.allocateString checks the produced string. BigInt and
Symbol counts remain invalid. Extra arguments do not affect the operation.

## Verification

The initial 13 regressions plus the existing string-method suite passed all
35 tests (522762). Expanded coverage adds receiver validation, empty-string
infinite counts, pending/completed checkpoints, direct calls without interpreter
context, and output string-budget enforcement.
The expanded regression and existing string/coercion/retention selection passed
57 tests in four files (47aaf2). Targeted ESLint and the maintained package
TypeScript configuration passed (a8cf79).

No CLI visual behavior changes. No push or release is authorized under the
current release hold. The previous full-package result predates this repair;
its remaining ISO/Temporal and host Promise admission failures are unresolved.

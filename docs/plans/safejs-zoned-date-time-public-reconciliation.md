# ZonedDateTime public integration reconciliation

## Scope

Reconcile the pending ZonedDateTime constructor, input reader, fifteen public
test files, and the DateTimeFormat option reader's explicit-zone rejection
mode. The shared formatter validation-order fix was committed separately as
`21fbad9aa`. No additional runtime bug fix is claimed by this integration.

The constructor validates epoch, zone, and calendar before selecting the
new-target prototype. Methods read private receiver fields and construct
results with captured realm prototypes. Input conversion reads and coerces
guest properties in order before applying overflow, disambiguation, and offset
policies. Locale formatting rejects an explicit timeZone before coercion or
reading later component options; other Date/Temporal callers retain their
existing behavior.

## Coverage

- Construction, subclassing, getters, private-field copying, forged receivers.
- String/property-bag conversion, option order, range and offset policies.
- Calendar arithmetic and differences across DST, zone/calendar compatibility.
- Rounding, formatting, transitions, skipped midnight, compatible overlap
  resolution when replacing plain time, zone/calendar replacement.
- Intrinsic result types, captured methods and completed replay.
- Locale components, receiver branding, explicit-zone rejection and calendar
  compatibility.

Added six independent constructor/format tests for both epoch limits in UTC
and at offsets +23:59 and -23:59. All six exact strings agree with native
Node 26.8.1 in a same-process comparison. Added MonthDay and YearMonth partial
input rejection to the existing private-brand guard test; native rejects both
without reading a shadowed calendar getter. These cases already worked and
are coverage additions, not newly repaired behavior.

Native versus guest named-property metadata matches for all five constructor
properties and 49 prototype properties, including function names, arities,
accessor names and descriptor flags.

## Verification

- Public ZonedDateTime cohort plus shared option-order regressions: 87 tests
  across sixteen files passed on Node 22.23.2 and Node 18.20.8, no skips.
- Package TypeScript check with `--noEmit` passed.
- Focused ESLint passed for both adapters, the shared locale reader and all
  fifteen public test files.
- Seven Date/Temporal locale and ZonedDateTime owned-value/copy/host files:
  141 tests passed on Node 22, no skips.

These checks run against the current working tree. Public namespace wiring,
other Temporal factories, Intl interop and snapshot changes are still partly
uncommitted; this is not a claim that standalone HEAD is complete or that the
full package gate is green. Host ICU locale-data and extreme-range Intl gaps
remain unresolved. No CLI appearance changed.

## Delivery

Commit the integration locally with its tests and README status update.
Do not push, publish, or close issues during the release hold.

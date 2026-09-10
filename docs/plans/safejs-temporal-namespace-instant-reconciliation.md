# Temporal namespace and Instant public integration

## Scope

Reconcile the remaining Instant constructor/factory/method implementation,
rounding and difference helpers, Temporal namespace prototype wiring, runtime
binding and lint admission. The eight type factories are now included in local
commits. Connect the existing Now implementation to the run clock and declared
default-time-zone host operation, preserving completed replay records.

Reviewed Instant BigInt and millisecond conversion, epoch range checks,
new-target realm selection, signed arithmetic, positive-coordinate rounding,
difference options, original-realm result prototypes, private-field getters,
zoned conversion, locale formatting, namespace descriptors and registration.
No new algorithm defect or repair is claimed in this reconciliation.

Two added namespace tests verify all constructor descriptors and cross-type
result prototypes after namespace constructor properties are replaced.

## Evidence

The initial Instant/Now/lint cohort passed 184 tests across twelve files on both
Node 22.23.2 and Node 18.20.8, with no skips. Runs took 66.75 and 87.59 seconds
respectively under high machine load; no timeout was raised or case removed.
The final Node 22 run, including both new namespace tests, passed 186 tests
across thirteen files. Package TypeScript checking with `--noEmit` passed.
Focused ESLint passed for the pending Instant/namespace sources and tests,
runtime binding, new namespace test and lint admission list.

Native Node 26.8.1 metadata matches for all ten namespace keys, seven Instant
constructor keys and fifteen Instant prototype keys, including symbol keys,
descriptor flags and function/accessor names and arities. This comparison sorts
keys and does not assert identical enumeration order.

## Remaining work

Snapshot restore/serialization and Intl Temporal interop still have uncommitted
changes. These checks use the current working tree and do not prove standalone
HEAD or full package completion. ISO locale-data failures, host-Promise import
policy, performance failures from the last full gate and other recorded gaps
remain open. Now retains the run clock's actual millisecond precision.

No visual CLI change. Commit the public integration locally, without pushing,
publishing or closing issues during the release hold.

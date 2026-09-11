# DateTimeFormat requested-options accounting

## Validated undercount

DateTimeFormat retains both resolved and requested options. The latter preserve
caller intent for Temporal formatting; they are not necessarily the same data.
The committed data visitor measures resolved options and the bound format
closure, but omits requested options.

An in-memory comparison of the HEAD visitor with current dependencies measures
94 units for a formatter retaining 132 units (29c84a). The 38 missing units are
the requested record `{timeZone: 'UTC', hour: 'numeric', hourCycle: 'h23'}`.
The working-tree visitor includes that record and matches the independently
measured private records plus the owning object's unit cost. No runtime source
was swapped out or rewritten for the comparison.

## Reconciliation and checks

Commit the existing one-line requested-options visit with new tests for exact
accounting, aliases, the exact data-budget threshold and compatibility with
older restored formatters lacking requested options. This does not commit the
separate snapshot serialization/validation changes.

All 62 tests in the focused accounting, requested-options snapshot and public
DateTimeFormat selection pass (51459f). The snapshot tests exercise remaining
working-tree integration and are not proof of a fully committed replay layer.
Scoped lint (f8775d) and package TypeScript (23e756) pass.

The full suite is still not green; locale compatibility failures are separate.
No push, publication, or claim of complete Temporal/Intl conformance.

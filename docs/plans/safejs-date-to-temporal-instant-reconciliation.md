# Date to Temporal Instant conversion

## Validated missing method

An in-memory comparison of the committed Date factory and working-tree factory
confirms that Date.prototype.toTemporalInstant is absent from the former and
present in the latter (c461d1). Reconcile the existing implementation and its
ten tests as one local change.

The method reads the Date private time, converts integral milliseconds to
nanoseconds through BigInt multiplication, creates a private Instant, selects
the method's own realm prototype and charges the produced data. It does not
consult overridden conversion methods, constructor/species or extra arguments.
NaN time fails with RangeError; non-Date and Proxy receivers fail with TypeError.

Native Node 26.8.1 probes agree on the five tested timestamps (zero, +/-1ms,
and both +/-8.64e15ms Date limits) and all three receiver errors (c82672).

## Qualification

All ten conversion tests pass on Node 18.20.8 (805ed2), including exact epochs,
metadata, non-constructibility, coercion avoidance, replay and method-realm
ownership. The initial Node 22 conversion/realm selection passed 15 tests
(27c570); its nonexistent globals/date.test.ts filter did not add coverage.
The corrected broader selection uses src/date.test.ts and globals/date-*;
all 301 tests across eleven files pass (7967a3).
Scoped ESLint passes (f00917). The maintained workspace build in 3fe310 compiled
this same Date implementation successfully before this reconciliation.

Public Temporal installation and replay integration are still partly
uncommitted, so the integration tests' working-tree passes are not proof of a
standalone committed release. This does not resolve locale gaps or the failing
full suite. No push or release under the hold.

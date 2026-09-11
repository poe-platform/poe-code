# Exact bounded duration division

This atomic change adds an internal BigInt quotient helper and independent
numeric tests. It does not add the public Temporal API: that integration is
separate, uncommitted work.

Convert a bounded Temporal span to a Number of fixed units or positive
calendar-interval units. Determine its binary exponent, divide for a 53-bit
significand, round ties to even using the exact remainder, and apply the exact
power-of-two scale. Round only once; do not convert the numerator or calendar
interval to Number first. The input domain is bounded Temporal arithmetic,
not arbitrary BigInt fractions with subnormal or infinite results.

The original hour discrepancy is covered by the upstream
[Test262 numeric dataset](https://github.com/tc39/test262/blob/main/test/built-ins/Temporal/Duration/prototype/total/precision-exact-mathematical-values-6.js).
The helper was first developed with a failing import test in an isolated
candidate, then compared with an independent 120-fractional-digit decimal
oracle across fixed units, deterministic spans, exponent boundaries, binary64
halfway cases and both signs. The isolated candidate matched all 40 signed
results from that upstream file; this is not a full Test262 run.

Calendar integration exposed another real discrepancy: 15702706861721167 ns
divided by a 365-day year. Both plain and zoned public regressions failed before
the exact-interval path (edeea9); the correct result is 0.497929568167211.
Extended helper tests cover 23/25-hour days and 28/31/365/366-day intervals,
including whole-unit contributions and signed values. The numeric helper itself
has no dependency on the uncommitted Temporal backend or guest types.

Validation on the integrated working tree: 82 tests across public total,
standalone numeric helper and Duration replay passed (64b520). The maintained
selected-workspace build passed 23 tasks and five fresh ESM imports (db2484).
Scoped runtime/helper lint passed (51dc27), and final public-test lint passed
(60bfcb). Node 18.18.2 built CLI returned the corrected year and hour fractions
(5ec5f4). These integration checks do not establish complete Temporal support.

Commit the helper, its adjacent test and this plan only. Preserve the user's
staged safe-bash changes. No push or release while the release hold is active.

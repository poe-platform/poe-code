# Boxed Number accessor snapshots

The full-package gate failed an accessor-boundary assertion that required
dumping a boxed Number with a guest getter to reject. Current guest-boxed
capture preserves accessor descriptors and prototype state, so successful
capture alone is not a defect.

A direct probe (1ab474) executes a getter using its boxed receiver and captured
counter. The original run and two JSON snapshot round trips all return
`[8, 9, 2, true]`: receiver value plus read count, exactly two reads, and the
original Number prototype. No runtime defect was reproduced.

The boundary test now checks boxed Number snapshot replay and stable recapture,
as it already does for objects and arrays. Both data-copy rejection assertions
remain. Added behavioral coverage verifies getter execution, captured state,
receiver and prototype through two replay cycles. No runtime source changed.

All 43 accessor-boundary and symbol-accessor replay tests pass (6df4c6).
Scoped ESLint passes (475045). README distinguishes checkpoint support from
lossy data copying. No push or release was made.

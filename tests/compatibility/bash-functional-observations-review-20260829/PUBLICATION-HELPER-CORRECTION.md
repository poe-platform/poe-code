# Versioned DATA helper correction

The first supplementary publication check exited1 at its `state.halted ===
false` assertion. Its source, stdout/stderr and exit are retained. It launched
no child/native/product and returned naturally; this is an ordinary captured
DATA schema-assumption error, not evidence of an observed unsafe native event.

The final snapshot deliberately contains `halted:true`, `closed:true`,
`noReuse:true`, `actualAttemptConsumed:true`, matching CLOSED.json's closedAt.
The immutable earlier eight-child snapshot has halted:false. The v2 check
requires the exact final closed state instead, and still requires all13
administrative exit/close/both-EOF observations, zero errors/signals, exact raw
captures, deadlines and unchanged first-eight records. No author bytes or
original47 DATA predicates are modified. The first failure is not rescored.

This version is sealed on disk before its DATA-only execution. No assertion
that a bare halted:true can safely be ignored is introduced. The supplementary
locator has no old committed expected digest; its fresh snapshot qualification
is retained independently of the schema correction.

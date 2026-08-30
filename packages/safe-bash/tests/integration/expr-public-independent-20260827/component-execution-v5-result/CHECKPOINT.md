# EXPRPUBLICCOMPONENT v5: transport qualified, exact cohort HELD

Authorization August 28, 2026. Exactly one presealed invocation, no retry or
postfreeze expectation changes. Recipe `94b040e35d2a2c40ee006e65062a42f8f46292ff`;
recipe manifest `c2e3b0b966f055883ccdd9a92a4abe398f842943574f031edbbc56cdf685ee69`.

## Complete denominators and actual failures

Each of installed Node22, installed Node24, physically moved Node22 and moved
Node24 executes package9 -> runtime26 -> types10, in that order. Each records
9/9 package, 25/26 runtime, 8/10 type passes. Totals:

- Runtime **100 pass / 4 fail / 0 unrun of104**.
- Types **32 pass / 8 fail / 0 unrun of40**.
- Package controls **36 pass / 0 fail / 0 unrun of36**.
- New qualification **38/38**: 16 TRACE/ordinary transport and22 aggregate controls.

The same three assertions fail independently in EACH layout:

1. **R21**: the initial `bad\0arg` literal-argv case, dispatched through the public
   `CommandContext.invoke` wrapper, reports exit1 versus the frozen expected2.
   Child closes naturally with assertion failure. The later lone-surrogate
   variant is not reached. The failed exact() assertion does not retain the
   product stdout/stderr, so those bytes are not inferred or asserted here.
2. **N04**: actual compiler exit2 rejects invented `maxRegexSteps`, but its exact
   diagnostic is **TS2561 at line11**, suggesting `maxRegexStates`; the frozen
   assertion expects **TS2353**. Missing module/library diagnostics are absent.
3. **combined**: all six invalid inputs are rejected; the same line11 **TS2561**
   differs from the frozen **TS2353** expectation. Other five diagnostic tuples
   match. This remains a failed strict type assertion, not a retroactive pass.

`CHECKPOINT.json` enumerates all12 failures and their raw receipts. No silent
correction, rescoring, diagnostic relaxation or product fix occurred. Aggregate,
actual entry and actual outer exits are all **1**. Independent phases continued
because bindings and closure remained intact, not because failures were waived.

## TRACE and strict lifecycle evidence

All eight real product TRACE invocations finish naturally, above1MiB, with the
unchanged --traceResolution and full raw stdout/stderr retained and hashed.
Positive types and broken-declaration negatives pass in all four layouts.
The latter reach actual TS2305 diagnostics beyond the preview cutoff; no
forbidden successful source resolution appears. All40 type children settle
naturally; none is a transport kill or missing-tool placeholder.

Real compiler qualification detects TS2322 at byte2147158 and forbidden successful
resolution at byte1217837 on both Nodes, beyond the1048576-byte preview. Both
64MiB cap controls retain explicitly truncated prefixes and numeric/hash
receipts; overflow, incomplete-line, diagnostic-retention and ordinary1MiB cap
controls are killed and reaped as declared. Exit7 controls terminate naturally.
Synthetic controls receive no credit toward40 product-type invocations.

Strict R25 and R26 pass in all four layouts. R25 observes worker exit BEFORE
exec-only settlement BEFORE dispose, with50ms startup/1000ms request/max1 and
zero ready messages/requests. Actual product startup failure is status3; the
assertion child passes. R26 preserves both direct shared-definition contexts
and Shell exec/dispose boundaries, identical abort reasons and live siblings.
Held transport is not a CPU-contention claim.

## Accepted proof reuse and integrity

P01 is **BOUND_ACCEPTED_PROOF, NOT a fresh build**, from independent v4 evidence
`1ec1912001db43f803af46bb5dea89a7e397b83b`. Reauthenticate exact357 inputs and
accepted pack **727526 bytes / 834 members**,
`c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`.
No authorpack fallback, source rebuild, source-map rewrite or historical replay.
Reader16 and repair28 are reused accepted evidence, not new controls.

PRE and POST binding guards pass, including mode/hash and new-entry checks in
their declared scopes. All189 runner checks pass. Read-only audit authenticates
all **993 raw entries / 220703859 raw bytes**,444 per-channel receipt hashes,
**28028 actual main-load hashes** and **304 worker-load hashes**. There are203
distinct observed product module-relative paths; this is not834 module executions.
All834 pack members are independently bound. Physical rename and absent original
consumer path are recorded; no fake moved-layout or source-fallback claim.

All **90 execution-binding metadata children**, **222 runner children** and
**80 observed workers** close. Runner settlement:214 natural,8 declared forced
negative controls; every product/runtime/type child is natural. The outer entry
also closes naturally. Actual one-attempt interval is02:26:45.878–02:28:14.179 UTC
on August28,2026 (**88.301seconds**), not a72-hour completion claim.

Evidence manifest `b8605b3dfe7d35723d6d24627a797edb0a60165e614c5800e54ffba4e0ff08f1`.
Evidence seal `0a37b5795ac594f1a1e587786295bb0dd21019162b3c76cfff3607fec6c232b1`.
The10,154,080-byte streamed gzip archive retains complete raw and truncated
negative-control prefixes without duplicating predecessor archives. Finalization
guards are not a claim that arbitrary later appended entries are impossible.

## Remaining authorization

Next work requires an explicit root decision on the R21 invocation-boundary
expectation and a separately authorized diagnostic-fixture repair for TS2561.
Preserve this failed cohort; do not modify frozen expectations or rerun implicitly.
The preseal source-commit-versus-tree preparation mistake is separately preserved
in v5/PREPARATION.md; it caused no product invocation.

Accepted-DU and original gate remain **HELD/unrescored**; DU75 selection is not
acceptance. HTML stays separately root-accepted and untouched. No HTML, DU29,
TAP, whole76/fullgate, engine/TEMP investigation or product repair was launched.

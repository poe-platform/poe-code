# Twelve frozen invariant groups — evidence map

All source references below refer to immutable candidate
618d8967009117547ab476256bc6eb0a9463309a, not floating live files. Tests are
named cohorts with overlapping coverage, not an additive unique-test count.
All supplemental executable controls were authored after source inspection;
the original N/I controls and root policy predate candidate implementation.

| Group | Actual evidence and source boundary | Result / limitation |
| --- | --- | --- |
| I01 routing | Frozen N01; installed public regular-routing/registry check; author state discovery cases; runtime.ts:30,1001 | Regular builtin, direct/command/function routing; no getopts registry/default plugin addition. No newly invented builtin/declare/typeset dispatcher. |
| I02 lifecycle | N01/N02; actual exported-default public probe; author fresh-default/clone cases; shell.ts:149 and runtime.ts:1120 | Fresh visible1 defaults with existing export bits; clones do not initialize. |
| I03 origins | N03/N10/N14/N15, author ordering/state suites; runtime.ts:355,576,836,1772,1837,1863,1951 | Successful assignments reset; failed stores do not; aliases/internal publications differ from assignments. N04 exact-prefix restoration is deliberately nonnative. |
| I04 locals/isolation | N05-N09/N15; author state tests; separate concurrent pending public invoke test; runtime.ts:271,939,956,1570 | Function-entry local snapshot, corrected repeated bare local, dynamic A/E locals, shared groups/source/eval vs cloned boundaries; two blocked children resume independently and parent continues b. |
| I05 readonly/names | N11-N15 product-policy projections plus author ordering tests; runtime.ts:355,375,1668 | Checked fail-fast, late identifiers, readonly OPTARG kept including EOF; no unchecked deletion. Native partial status/output is not the product oracle. |
| I06 dialect | N02/N10 Unicode values, author ASCII-refusal case; runtime.ts:1657 | ASCII option/specification refusal with unchanged earlier state; Unicode values supported. No native multibyte-option parity claim. |
| I07 budgets | Public per-word, max-safe saturation, middleware admission, invoke exhaustion; author exact Budget-object test; separate normal128-command task-yield test; runtime.ts:316,320,515,1644 | Shared Budget, normal command charges, per-word/field admission, saturating private caps. No per-byte commands/global scanner-work/deadline API. No huge-allocation stress claim. |
| I08 cancellation | Public tiny final-flush and long checkpoint timers, five falsy/object reasons, blocked cleanup, pre-abort/late rejection; author prefix-abort test; getopts.ts:111,119,184 | Real tasks and final flush, identity, cooperative cleanup barrier and no resumed publication; opaque work is not forcibly preempted. Task-checkpoint mutant v2 fails intended rejection assertion. |
| I09 sinks | N16 and public gated/rejected/EPIPE/silent paths, author ordering and legacy owned-output suites | Awaited diagnostics, zero silent writes, human-readable exact admitted bytes, existing mapping; old36 holdouts and42 author cases protect destination ownership/backpressure. |
| I10 host invoke | Public literal argv/env replacement/copy/promotion, corrected D03 single-test supplement, author host suite; runtime.ts:925,990,1570 | Actual registry/context.invoke, final presence/value comparison, exported omission vs unexported retention, absent-to-absent, undefined invalid; both existing direct restoration branches preserved. Initial public expectation failure retained separately. |
| I11 no IO | Public sentinel stdin/VFS/stdout probe; source review of getoptsBuiltin and unchanged private helper | No stdin/VFS/stdout call in admitted builtin; source adapter/helper adds no process/network/ambient access. Harness/source/redirection IO is distinguished. Not a sandbox of arbitrary host JavaScript. |
| I12 ordering | N11-N15 product projections, public diagnostic rejection/blocked abort, author Runtime observation tests | Hidden scan before awaited diagnostic; checked index, checked argument, late checked name; first failure stops later stores without rollback. Internal observation is supplemental; installed public execution is separately proven. |

The accepted owned-output additions remain26/26 verbatim in the two scoped paths,
and their relevant existing regressions actually ran. This textual retention is
not by itself semantic proof; actual42/36/core/state checks supply the bounded
behavioral evidence. Two in-memory mutants are not alternative candidate commits.

## Explicitly unmeasured or outside this gate

- No new native process runs: reuse original authenticated Darwin5.3/3.2 captures;
  present native binary availability is not probed and Linux semantics not inferred.
- No getopts-specific actual SafeJS guest was added; the existing25 current-engine
  profiles were rerun, including actual supported facade/shell.exec positives and
  deliberately denied/failed controls. No installed private package/deployed
  provider/external network/hard-preemption proof.
- No broad just-bash comparison, full shell parity, whole-product gate, default
  plugin increase, unbounded work guarantee, universal security assertion or
  elapsed72-hour completion claim.

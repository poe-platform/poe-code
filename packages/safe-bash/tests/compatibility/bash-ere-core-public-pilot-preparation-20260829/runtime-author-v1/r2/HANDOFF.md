# Ordinary public pilot r2 — minimal N05 harness repair

**AUTHOR SOURCE/PURE READY FOR DIFFERENT DELTA REVIEW. NO ACTIVATION WINDOW.**

R2 profile SHA256:
`bacc21fb126bb6e0b5441bee560cb0bad1f7ffda01d129b996c1cdd3e6312e05`.
Prior profile SHA256:
`446f44cea9091ce59a12c5591bc1d6e91049003848bef33bd75f520c98728aa6`.
Independent HOLD commit `026d2e9fbd9bca460bb6267d7fc3e131540d754b` and receipt
`45dce84c4f0115c8abca42d4c8691f5fb9a9fd2f4791e7ec2b190c4656cca2f3`
were authenticated before constructing this delta. The old 14/15 result, N05
failure, author-preparation failure and Dirac/startup STOP remain unchanged.
N05 was a harness control-flow defect, not an engine finding.

## Exact repair

`finalization.mjs` owns one explicit presence-bearing failure ledger. The first
raw reason wins, including 0/false/null/undefined. Each descriptor close is
attempted separately, followed independently by retirement bookkeeping. Close
failure cannot replace an existing primary or skip the bookkeeping attempt.
Deletion requires every child receipt's retired field to be exactly true;
genuinely UNKNOWN child references remain rooted. Bookkeeping exceptions are
secondaries, not fabricated retirement. Secondary order is bounded to the existing
32 entries plus explicit omitted count; there is no new unlimited telemetry.

The r2 coordinator delegates its protected acquisition/run/finalization region to
that helper. Journal open and writer construction now occur inside this region.
If acquisition fails, already acquired descriptors and empty/known ownership still
receive independent finalization attempts. Emergency publication failure is
recorded rather than replacing the original acquisition/execution failure.

The r2 coordinator's private copy of `core.mjs` shares this ledger with schedule
publication and catches emergency-publication rejection into it. This avoids
losing the schedule's original raw reason before finalization even begins.
The normal cell copy of core is unchanged: the new core is coordinator-only.
Bootstrap fallback reporting was source-audited and guarded so a failed stderr
write cannot throw a new reason over the original. A failed reporting sink is
not claimed to have durably published its secondary diagnostic.

No product edits, observer changes, method interception changes, limit changes,
recovery, Worker termination or new runtime telemetry were introduced.

## PURE evidence and source-only boundaries

`PURE-RECEIPT.json`: **8/8 PASS**, one execution of each fixed group:

1. Exact N05 semantics: primary0 + closefalse keeps raw0 and removes known root.
2. Explicit primary presence for undefined/null/false/0.
3. Every close and bookkeeping attempted independently, ordered raw secondaries.
4. UNKNOWN retains the supplied child/root identity despite close failure.
5. Partial acquisition is protected; emergency failure cannot replace undefined.
6. Emergency, close and final-report failures preserve the original raw0.
7. Forty close failures retain the first32 ordered secondaries and omitted8.
8. Schedule publication and finalization share primary0 across null/false/undefined.

These are 11 finite finalizer calls and one pure schedule call; no case callback
executes. Host references/descriptors are fixed doubles, not native lifetime
telemetry. Three fixed source probes verify protected journal acquisition, shared
ledger wiring and removal of the old masking finally. The whole coordinator,
actual journal acquisition, real bootstrap fallback, native process ownership and
public cell are SOURCE-only, not dynamically exercised by this repair.

Exactly two file-based helpers ran: authenticated source-to-patch generation,
then controls/sealing. The generated patch was applied through apply_patch.
Actual Workers, native children, product imports, archive inflation, compiler,
npm/install, native oracle and network operations: **zero**.

## Minimal seal delta and preserved bound

`PROFILE.json` changes only its asset binding list: replace the old coordinator
with r2, add coordinator-only r2 core and finalization helper. The original core
binding remains for unchanged cell assets. All other profile fields are retained,
including inherited preparation metadata; the new receipt dates this r2 seal.
`GRANT-TEMPLATE.json` changes only the profile hash; authorized=false and all
activation/reviewer/window placeholders remain unset.

The 24 selector/definition/oracle/limit/config records, constructor forwarding,
public cell assets, source/archive/tool admission, root paths and proposed role
graph are unchanged. Source4abb and independent producer DATA acceptance5c2ef079
are not rescored. All actual24 cells remain UNRUN.

Conditional logical work remains **254938146 bytes**, with **13497310 bytes**
headroom under256 MiB. R2 source/evidence uses the existing8 MiB metadata/author
reserve; no cap increase or new runtime artifact class is claimed. Existing
40-role ceiling/36 enumerated, peak4, at most24 Workers/one-live, 1200 seconds
including180 publication, and64 MiB capture remain proposals awaiting review and
qualified outer authority. Sampled/quiescent dev-npm work remains non-atomic,
not peak/prewrite work proof or OS quota; observed excess STOP, capture prewrite
limits unchanged. Git internal physical storage remains excluded.

The prior trusted-npm regular-pin versus append/symlink qualification and missing
qualified outer owner/window are unchanged. Different quick delta review must
accept this exact source/seal before a separately authorized actual24 phase.
FULL135/six nonpublic/seven broader CORE and every other private hold remain OPEN.

## Current bounded publication

Current start2026-08-29T16:59:41Z, inclusive deadline17:07:41Z. This does not alter
the project endpoint18:02:36Z. Current grant:24 known OS roles, peak3,24 MiB capture,
96 MiB work. The completed publication plan totals23 launched command roles plus
one explicit outer-owner allowance = **24/24**, with no helper retry. Breakdown:
eight command shells, one date, seven Git commands, one sed, four apply_patch and
two Node helpers. Existing input storage and Git physical storage are not newly
created logical work; new profile/source/evidence fit the existing finite reserve.
Helper stdout/stderr are shell-opened before startup. One MiB current publication/
admin capture is reserved. Only r2 explicit paths are committed; foreign staging
and all prior packets remain untouched. No actual filesystem quota is asserted.

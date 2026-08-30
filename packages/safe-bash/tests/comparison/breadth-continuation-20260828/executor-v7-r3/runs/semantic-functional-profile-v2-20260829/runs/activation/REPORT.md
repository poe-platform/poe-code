# Functional-profile-v2 actual cohort — UNSAFE_STOP

## Bindings and verdict

One authorized attempt of semantic-functional-20260829-v2-01 ran; grant is CONSUMED. No retry, reprofile, guard widening or source change.

- Source45dd71f18882900070c5a925a5c01e0a6045aa5b; seal fb820b8b7d08ed2cd61af7d75c286ed133daa7a5457937061ffafd8e6982dce1.
- Independent review37026b85275a2fa4b015cc18b04d75d90fa6dc3c; receipt f4a16fa6346397219c2c779fd30bb249759467d7da3295e5f5e7e26ab6e1e8f6.
- Fresh grant1979eca53f1a878619e0442dc6184f84bec030b0; grantSHA d9b4f0c5e91f2b1b7b0c4c0db6110afa7c165f51ab5892182bffc53e04fccef2.
- AUTH/preflight ad57055df4cdcf06d50871ce9499da7cb57e3fa3; AUTH SHA3f12d2e88ad29d6754cef3c0da1dbe127f47c354ad1e66b0017f539a4cff2452.
- Target67eab12e315054907ef4ef435c6bbca2f59e0c36 / full858 pack6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06. Comparator pinned just-bash3.4.2 with unavailable-bootstrap PLUS public defenseInDepth:false, not stock/default-security parity.

## Exact finite outcomes

10/99 workers launched;89 identities never launched. Nine safe assessments completed:7 frozen-oracle passes and2 ordinary mismatches. Operation10 is a capability refusal and receives no semantic credit. FINITE-OUTCOMES.json contains all99 literal identities and exact captured statuses/stdout/stderr for the10 launched.

| Operations | Case/layouts | Observed result |
| --- | --- | --- |
|1–3|column, target-installed/comparator/target-moved|3 passes|
|4–6|date, same layouts|3 passes|
|7,9|du, target-installed and target-moved|2 ordinary frozen-oracle mismatches: status1, empty stdout; exact stderr below|
|8|du, comparator|pass, status0, stdout2 TAB data.txt LF|
|10|egrep, target-installed|capability refusal; Shell status2, worker exit1; STOP|
|11–99|remaining identities|UNLAUNCHED|

DU stderr in both target layouts: `du: "data.txt": allocated bytes unknown; total suppressed\n`
This is an observed mismatch against the frozen historical physical-allocation oracle; the target reports allocation UNKNOWN. It is not a newly established implementation defect or permission failure.

Operation10 stderr: `egrep: OFFLINE_DENIED:UNSUPPORTED_WORKER_ASSET_ADMISSION\n`
The exact guard event is offline-denied / UNSUPPORTED_WORKER_ASSET_ADMISSION / argument object. Object contents were not captured. The report says Worker/Wasm admission refuses before creation/compilation. No broad Worker capability exception is authorized. This is NOT evidence that egrep semantics are defective.

## Counters, captures and closure

New invocation accounting: semantic attempted10/fulfilled10/rejected0/unresolved0; empty setup attempted7/fulfilled7/rejected0/unresolved0; total17. Dispatch is not callee entry or pass. Legacy completed-only fields remain semantic9/setup6/total15. Raw caseCounts remain completed9/passed7/failed2/unqualified0/unrun90; the last value includes the attempted unsafe tenth operation. Do not rewrite those raw fields to the separately labeled1 refusal+89unlaunched classification.

1553 actual nextLoad observations bound to declared paths/bytes/hashes: seven target workers211 each; comparator25/25/26. Ten consumer evaluation witnesses;22 authenticated Git metadata children. Each worker config, source profile, raw invocation sequence and final counts reconciled. No C11 or trial calls.

37 known actual OS processes including two wrapper helpers retired: owner, launcher, coordinator,10workers,22authority children,2helpers. Seven preflight administration children also closed:44 before publication. Later publication children are separately recorded. All worker reports have pending0/descriptors0; target disposal completed; comparator disposal API is absent as previously qualified. Operation10 has one guard violation. No claimed host-global process/thread census.

38 channels reconciled at1,265,401 observed and retained bytes, zero loss. This does NOT override owner captureQualified:false, inner coordinator natural:false or worker10 natural:false. The launcher itself exited1 and was reaped. Cleanup error arrays are empty. Raw protocol verdict is UNSAFE_STOP/SEMANTIC_TERMINAL refusal.

Standalone post-stop DATA verification passed491 source/tool/authority checks plus all retained physical views, offline closure and archives. This is separate from raw owner postflight:false, not a rescore. Preflight authenticated858 tar members,3843 comparator files plus1 instruction metadata-only omission, and860/860/3845 installed/moved/comparator view files. No new stage/build or engine proof was substituted for actual loads.

## Limits and next barrier

Actual source remained unchanged. The fixed99+66 schedule,336-process/peak5 topology,75+15min windows,257MiB partitions and per-worker limits remained unchanged. No timing/performance conclusion. All raw runtime files are retained, including multipart documents and nonzero dispositions.

Next ROOT decision is how, if at all, to qualify the denied Worker-asset requirement under a separately reviewed capability policy. No repair or further run is authorized by this result. W03/W07 were unrun; their original partial/uncredited qualifications remain. Old91d75f2b/2084983a, V6 lost294045, N02 loss and all historical scores remain immutable. No overall winner/current-Bash/native/full-gate claim.


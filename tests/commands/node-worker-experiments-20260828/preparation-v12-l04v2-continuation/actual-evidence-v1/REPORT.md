# v12 actual Worker continuation — scoped handoff

Source/preseal **d0b49b439d53843ab12bdd92d01815a891c624b6**. ROOT grant **751142302abfd2db1bdc3bf7c11c96e1395b5e9b**, SHA256 0fbb32666abea9c10b202a8fc5d4a7f0ad15a847129dea876a3aaae3b6e47265. Preseal SHA256 db2732135e5ec7368e7d74a476f0e1f5bfceb63288911212d1d166b5079b7996. ROOT profile ratification c0ed1f0d6a12e21c3471a7c7ab21196edc2202db. Grant is SPENT; no retry or further slots.

## Exact outcomes
31/31 finite DATA controls passed first, one harmless Node child75ms/1375 raw bytes; no engine/Worker. Then ONE actual cohort: **8/8 frozen case judgements qualified,7 clean and1 expected failed cleanup**. Actual8 Workers,7 public-run attempts and7 entries proven by fixture-specific bridge activity. No L01–L03 replay.

|Case|Actual status/output|Disposition|
|---|---|---|
|L04v2|0, entryReturned, exact entry-return newline13B|Qualified; no admission deadline|
|L05 undefined/false/object|raw status null, empty channels|Three exact caller-reference witnesses, including explicit undefined;3 separate late-parent secondaries|
|L06a|raw caller, X write1B retained|Qualified; committed write not delivered; cleanup held until exit then settles|
|L06b|raw sink primary then distinct cleanup rejection, X retained|Qualified; cleanupSettled=true but cleanupClosed=false and clean=false|
|L07|0, exact unsupported/denied/undefined output59B|Qualified, denied write has no effect|
|L08|raw worker-control, observedOom=true, exit1|Qualified trusted heap-only Worker;0engine/guest evaluations|

All8 actual Worker exits and parent cleanup settlements confirmed;7 successful cleanups plus1 intentional rejection.8 termination requests. Normal entryReturned terminals2, guestFailure0, terminal absent6. Null raw statuses are NOT shell success statuses or actual Shell error-mapping proof.

## Diagnostics and counters
**All8 Worker observations are DIAGNOSIS_UNKNOWN**: text absent/faultfalse. Publisher return fault is still discarded; no observation-success inference. Parent diagnostic sidecars published8 records covering10 raw-reason summaries; actual reason identity was compared in live parent references by the existing judge, not inferred from serialization.

17 enrolled RPC operations with actual cleanup events;16 effect admissions plus1 denied-before-effect.12 final ACKs and12 distinct later postcopy markers.13 retained outcome records:12 closed=true, plus L06a unacknowledged/undelivered closed=false. Its separate operation cleanup event follows Worker exit; do not count13 closed outcomes.29 logical bridge callbacks are DERIVED from17 enrolled request callbacks+12 postcopy callbacks, not an independent raw wrapper-counter measurement.

FS development-map scope:6 module authorizations;3 reads started/cancelled,0 successful reads;3 writes requested,1 denied,2 committed2B, only1 committed write delivered.5 output attempts,4 published72B,1 sink failure. No actual service/native filesystem claim.

## Source and actual loads
126 capsule inputs authenticated before copy and after execution, full owned output census. Existing95 engine emissions1076164B unchanged; no compiler. Engine bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e; Node22.22.2 full streamed tool binding in BINDINGS.json. No new builtin edges. Worker observer exact old util edge unchanged.

Guest6995B SHA256 2674a7fd2fb7b01632a0fb1e9e3252f0831c7bd2b696fde9e5c9dbd217ced742; only new Promise(() => {}); → Promise.race([]); replacement. New profile/selection/parent evidence classifier and safe-settlement aggregation are versioned, not claimed unchanged harness. Actual Worker load reports99 each×7=693 records (93engine+6helpers each), plus14 parent loads. L08 has no Worker load-attestation report; its trusted bootstrap/body are source-bound and actual OOM is observed, not fabricated engine execution.

## Bounds and retirement
Parent PID34523 natural exit0/no signal; owner3893ms. Outer203B security-warning capture,1 write, both descriptors closed; no primary/secondary capture faults; Worker native output0. Prep7 OS children,375392ms. Actual subject1 OS child plus3 publication-tool children planned/closed before handoff; peak2 OS processes counting existing owner,1 Worker thread at a time. No universal tool-startup wall bound.

197056-byte SAB;16MiB command-owned ledger;1MiB parent diagnostic and64KiB Worker diagnostic reservations retained. Maximum prepublication tracked peak15237568B; V8 old32/young8/code8/stack4MiB. Not RSS, wholeguest8MiB, or all-jobs-settled. TERM→2s→KILL branch unexercised/source-only. Owned resources retired; authenticated artifact root retained, not removed.

164-file archive1498668 raw bytes/547817 base64 bytes; roundtrip authenticated SHA256 cce21b11cf14029313488daa2cdc678d3c5a39dc50ba11620997f6cec35f0392. All raw captures, receipts, judgements, diagnostics, load reports and owner census included. BINDINGS.json SHA256 5e4bfde86c3dabd3cde80a0c1ec7127a8b054d3310c58670b3f59d3301f17fbe.

## Remaining scope
K1 actual finite public-provider guest workflows, not complete Node/NP1/CLI semantics. K2 actual12 postcopy deliveries, canceled/failed/undelivered operations remain distinct. K3 tracked-ledger and contained V8 heap only, not global allocation/RSS. K4 actual exits/settlements, but owner forced-kill and adversarial launch branches remain source/control qualifications.

L04v2 proves normal entry return with the source-defined unawaited race, not independently measured pending-engine queue or all-jobs settlement. Original345b/2eb/2871 failure/unsupported records remain unchanged, including the constructor negative. All current8 slots executed; no historical rescore. No new product module, private access, compiler, install, network or native fallback. Different review/root acceptance still governs any subsequent work.

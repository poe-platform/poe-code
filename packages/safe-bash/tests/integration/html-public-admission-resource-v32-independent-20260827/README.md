# Independent v3.2 resource-profile evidence

## Result and scope

ONE actual independent invocation: **5 declared / 5 executed / 5 expected /
0 unexpected / 0 unrun**, no retries. All five original safety gates accepted.
Read-only independent durability/numeric/cleanup postcheck: **21/21**, zero
postcheck failures and no predicate re-execution. This is qualified acceptance
of this new fresh-process stream-component profile, NOT whole-verifier RSS,
product/public/HTML74 acceptance, a historical rescore, or a root release.

Recipe commit: `c308fc79ea1e0a5ff7fe8d3bdcc116aadc09825b`.
Recipe manifest SHA256:
`8970bef9f5b58b1c094fc08f70924b3209c683cc5a8f9e6542af63c218579f8d`.
Separate evidence commit seals EVIDENCE-MANIFEST.json and captures.tgz; the
manifest authenticates every envelope file other than itself and the archive.
RAW-INVENTORY.json records every archived file/hash/size and directory, including
raw stdout/stderr, statuses, numeric receipts, journals and observational traces.
COMPACTION.json records authenticated tar, exact extraction/hash verification
and scratch cleanup. Original author/evidence files were never written.

Actual launch: August 27, 2026 19:36:13.494 America/Chicago
(`2026-08-28T00:36:13.494Z`). Coordinator close, final subject/group probe and
postauthentication precede independent settlement at 19:36:45.566 local
(`2026-08-28T00:36:45.566Z`). This interval is 32.072 seconds, not a72-hour claim.

## Five outcomes (exact bytes)

| Case | Consumer RSS baseline / peak | Consumer terminal | Producer terminal | Forwarded failure |
| --- | ---: | --- | --- | --- |
| positive | 52,477,952 / 106,332,160 | 0 / null | 0 / null | none |
| producer-exit7 | 52,707,328 / 97,533,952 | 17 / null | 7 / null | STREAM_PROCESS |
| consumer-failure | 52,592,640 / 55,967,744 | 17 / null | 1 / null | V3_CONSUMER_FAILURE; structured EPIPE/write/-32 |
| timeout | 52,936,704 / 56,360,960 | 17 / null | null / SIGTERM | V3_TIMEOUT |
| allocation-mutant | 52,822,016 / 273,285,120 | null / SIGTERM | null / SIGTERM | V3_RSS_LIMIT |

Positive telemetry peak106332160 and original core maximum106315776 are both
strictly below absolute268435456; no baseline subtraction. Exit7 and other
negative cases remain failed subjects with expected exact diagnoses/statuses;
their expected outcomes are not product passes. Concurrent host load is not
controlled. Observational preload/fsync overhead is included, not corrected away.
Samples are current process RSS, not continuous maximum or total-verifier memory.

Positive and exit7 each consumed1073872896 bytes/16386 chunks with the unchanged
expected SHA256. Consumer-failure/timeout each consumed1048576 bytes/16 chunks;
allocation consumed1703936 bytes/26 chunks. All consumers maxPending1,
maxPendingBytes65536, maxChunkBytes65536, final pending0/pendingBytes0.
Producer high-water mark65536 and maxPendingDrains1 are recorded separately;
partial producers' accepted writes are not represented as delivered bytes.
Baseline/latest/fieldwise peaks for RSS, heapTotal, heapUsed, external and
arrayBuffers for consumer AND producer, plus excluded supervisor telemetry,
remain in RESULT.json and the exact raw archive. Producer baseline/peak RSS:
positive47104000/58556416; exit7 47022080/58228736; consumer-failure
47022080/53149696; timeout47087616/52084736; allocation47038464/53051392.
Per-case raw settlement intervals:1991,2042,351,675,1243ms respectively;
inter-case authentication is separate.

## Numeric ordering and actual cleanup

The independent observer forwards unchanged calls, records completed fsync with
monotonic timestamps, first postraw assertion, signals and actual ChildProcess
exit/close. All five RAW-RECEIPT files and both subject numeric receipts were
fsynced before the first postraw assertion. All ten subject processes have
observed exit AND close, not merely saved status claims. Worker/producer PIDs
were absent; each original group probe was empty. The outer supervisor then
observed coordinator exit/close and probed all eleven PIDs and six groups before
final settlement: **11 absent / 6 empty**. Synchronous git/ps/tar helpers were
awaited through their return/status records, and compact extraction/raw scratch
was removed only after byte-for-byte hash/inventory verification.

Timeout producer97253: actual worker signal120802772851666ns; producer exit
120802808067500ns with pipeDestroyed=false; owned pipe destroy120802808197166ns;
producer close120802812005833ns; original error throw120802812201500ns; core
settlement120802820149750ns. Exact code AND message V3_TIMEOUT survive; no EPIPE
alternative substitutes for this strict SIGTERM path.

Allocation retained26 touched8388608-byte Buffers,218103808 bytes total,
touchedByte180. Boundary RSS272678912 exceeds268435456 by4243456, within the
unchanged overshoot budget. It is not a cap-exhaustion substitute. Producer97395
actually exited SIGTERM while stdout remained open, before owned pipe destruction
and close. Both final receipts and BEFORE-KILL were durably written; producer
was absent before the still-live worker97394 was signaled at120806615899458ns.
kill returned true and actual worker exit/close were null/SIGTERM. The peak above
threshold is an intentionally failing resource subject, not a compliant pass.

Consumer-failure retained actual identity-bound structured EPIPE/write/-32 with
producer1/null, exact original caller Error identity, and consumer17/null. The
unchanged predicate also permits its original strict SIGTERM alternative; the
actual run here used EPIPE. No broad diagnostic relaxation occurred.

fsync completion is file-level evidence, not directory fsync or power-loss proof.
Producer baseline/sample journals precede its first SIGTERM; the producer's
final receipt is written by the existing signal handler before self-SIGTERM.
Only the subsequent allocation WORKER kill follows both final receipts.
PID/group absence is a point-in-time observation, not an identity lease.

## Static findings and immutable-input checks

Exact author recipe e27a62c40a317deae83fc1ef9d41d57f38d7d51d / manifest
968c52402f4c10507fb7c5410b33086bba33e7209b7030b42e7859b4c85c1980 and evidence
2bfeb0e12e342c34cd163f2453c9edd8d0190630 / manifest
3c46668c88d0f01081020c19a93f761fe4b90e780e30406b75df0e4ccc858d3d authenticate.
All176 sealed files, all78 prior files, exact narrow inventories including added
entries, every AMENDMENT old/new hash,103 original source bindings, original
tools and actual imported core/worker/predicate bytes authenticate pre/post.
The complete v2 core remains
446c14f2e12753b8933aa307f7ce8b0dec90dd251bbd613e64a484c26397340d.
No whole live-tree census or unrelated cohort was used.

The five-case controlRun body hash7476775ef27f0268266168e6831e8385e0c58be82308e055fab98a28af92c85f
is unchanged. ADAPTATION.json binds original coordinator56ff7bdc05f5546b79fbd401f33f8b930e5081a1708a65cb5b3d177938d6049d
and adapted coordinator dae7a0014e4af0aa2754e3cd0d99ddcd7f0ed0dd094a3e9c1b140aec9c73b74f
with twelve explicit import/output/precontrol-selection replacements. Original
worker/core remain imported untouched. The separately sealed observation preload
adds only its disclosed --import flag, forwarding exact original arguments/results.

Author28 unchanged synthetic/6 forwarding/8 ordered/33 read-only counts and their
saved evidence are STATIC-authenticated only, not independently executed passes.
Own actual denominator is five; own read-only postcheck denominator is21.
No observed resource-profile defect. Static limitation: the author's bounded
hard-deadline unsafe fallback unrefs without guaranteed close; it rejects/stops,
so this run establishes successful cleanup only on the observed five paths, not
universal reaping. The normal core remains unchanged, not repaired by this review.

Tool /usr/bin/tar explicitly resolves to /usr/bin/bsdtar, SHA256
bdccb76a715fbebc4915a1a1b1de0e7050ad842ebb730c47935b3a22c13e3af9.
This is an authenticated tool alias, NOT a waiver for prohibited build symlinks.
Node22.22.2/git/ps and bundled Node builtin code identities remain pinned.

Two frozen metadata corrections, with no source edits or rerun: recipe manifest
says7 syntax-checked modules but actually contains six, all checked; REVIEW's
lock/auth wording is imprecise. Actual launch authenticated the independent
recipe before exclusive lock, authenticated originals after lock and before
spawn. Both precede actual cases. Frozen originals remain unchanged. No
verifier-only postcheck failure occurred (21/21); these are documentation/count
corrections, not repaired failures or a new generation.

## Remaining boundaries

Original independent d28083dd admission-v2 stays34/35 RSS HOLD with numeric
measurement lost/unrecoverable. e579a96c diagnosis proves no old cause/rescore.
All v2/v3/v3.1 failures remain; missing first raw rejection stays missing,
separate synthetic capture stays synthetic, and three author development fails
remain retained. No composite historical gate pass or historical RSS cause claim.

Separate partial-leaf recipe bf72a1f9d0eaa843e1e3a33949993a7d4a338d96 and its
one4 controls +410build/830pack/two-path reconstruction remain untouched and
unrerun here. Root must combine those separately scoped results and authorize
next admission. **HTML actual34 remains0/unexecuted until root release.** No
product/public/HTML74 acceptance. DU29 and A06/P03 remain held; no DU reruns.

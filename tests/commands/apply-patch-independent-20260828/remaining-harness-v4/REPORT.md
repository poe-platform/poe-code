# Remaining harness v4 — proposal authored, control qualification STOP

2026-08-28. Only this delegated subtree changed. Product remains READONLY and
unexecuted. Code/proposal/preseal atomic commit:
`b6cd295c05478a530937b6617723e419877b7635`. Evidence is a separate explicit-path
`git commit --only`; its identity is supplied in the final handoff, not embedded
self-referentially. No source changed after the preseal commit.

## Single launch and exact blocker

The fixed launch used the sealed absolute Node path and `exec -c`, login false,
with the committed-preseal ID and SHA256. It returned **exit1**, terminal result,
no continuing tool session. At `controls.mjs:20`, before output/work creation,
the asserted empty `Object.keys(process.env)` was actually
`['__CF_USER_TEXT_ENCODING']`. Only the key, not its value, was printed. The
origin of that key was not investigated; an OS/runtime injection is not proven.

**One launch, zero retries; 0/6 controls completed, all6 unrun; zero of the two
planned children spawned.** R01/R02/R03/B01/G01/P01 never ran. Consequently there
is **no dynamic proof of valid relocation or nested-process cap** and no new
control PASS. No proposed remaining-cohort job ran. This is harness startup,
not a product/Node-compatibility/compiler failure.

The startup assertion precedes the controller try/finally, so it also bypasses
its normal outcome capture. No OUTCOME.json, child PID census or controller
monotonic duration was produced. `attempt-01/LAUNCH-OUTPUT.txt` preserves the
tool-rendered diagnostic as a transcription, NOT an independently authenticated
raw pipe capture. This capture limitation is retained, not papered over.

Post-exit evidence-only inspection found output/work absent and all8 sealed own
files plus29 named source/data/compiler-source bindings unchanged in bytes,
length and mode. No compiler or bound JavaScript was imported by that inspection.
Only then was `attempt-01/` created to preserve terminal evidence. No deletion,
kill, descendant search, new control, environment adjustment, permission change,
source correction or retry followed. The exec handle establishes terminal exit;
controller PID was not captured, so no exact-PID absence probe is claimed.

The reachable failed epoch was one controller and no children; this is not the
requested successful peak2/retirement experiment or an all-OS process census.
Controller-generated work/capture bytes were zero. The duration bound and capture
supervisor were not dynamically qualified. Persisted evidence sizes/hashes are
listed in EVIDENCE-SEAL.json; they are small static post-exit records, not control
stream measurements. No operator administrative process overlapped this epoch.

## What is available for different review

PROPOSAL.md and CALLGRAPH.md provide the versioned repair proposal and inspected
old/new OS-process routes, including administrative Node -> Git, guard, compiler,
product loader, archive, finalization, platform Git launcher and hooks/signing/
fsmonitor/maintenance/filter/helper risks. The prototype has presealed distinct
moved names, strict exact-existing authentication and refusal routes, a direct
isolated metadata Git child and a permission-contained nested-spawn fixture.
These are **authored but unqualified**, not verified fixes.

The proposal may be reviewed by a different reviewer; **it is not ready for
execution admission**. Exact blockers before another version can be considered:

- Separately author/review a truthful platform startup-environment contract,
  without broad permission or source-auth changes. Do not modify this preseal.
- Put startup failure capture/closure in the bounded evidence path. Do not
  manufacture this missing receipt or rerun this consumed control attempt.
- Obtain a new separately authorized/versioned control attempt demonstrating
  actual nested denial/close and error-free relocation; this attempt did neither.
- For the actual43 cohort, root must separately choose/approve the committed
  runtime-seal protocol or explicitly approve durable-seal/serialized-handoff
  contract changes. Isolated Git ls-tree would not qualify real-repository commit
  machinery even had it passed. Full source bindings and permissions stay strict.

## Identity ledger (SHA256)

| Binding | SHA256 |
| --- | --- |
| PRESEAL.json | `14019b529fcd5483d2e40e0200165a601ce32d5b5762d88fb3d239c4224ec128` |
| PROPOSAL.md | `fbf911e0cb5288eeb6c47466754a49e283f545f7d1b100cb0f11918d82949f20` |
| CALLGRAPH.md | `7cc093496809e9683437455b3cf48bae3e8c3c3a2417f6b2873444d104b760a4` |
| controls.mjs | `2db32ebe23c5d9709cdb641a398ce4afaf032c296d8d837ce3eab9f8d75e104e` |
| primitives.mjs | `530e645e2bf0c3b22fa1d2e9af77407d5fb52742858b569f60b058927bda42d9` |
| nested-child.mjs | `d8399e72c636a7c752c30b8e7970cfd8b254aa0935fdcdb5e0aeefd0f1f7e2f3` |
| INPUTS.json | `62e085564f346b42d820efe7d58b57cd39e1072e8d4c7cadaf979cfa2098936d` |
| REMAINING.json | `3fb8d6323eb1c6090ccfa07e79d72f8f574a931d829a63db321ac3358f8eabf0` |
| Eight-file source manifest | `fcfa00d957c95cac71b0f7dd564eed049759587fe5b89b0417e63e4193e6e23f` |
| 29 named source bindings | `6549f27a6d5da407a30cc54ae9f4aa140af8b724e5156c0947cef774c813d88f` |
| Node v22.22.2, 112989184 bytes | `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011` |
| Direct CLT Git, 7604272 bytes, unexecuted control | `be4afb2b003904725826250de9fb76567bbacf82323457b5a1ec26706b66bcae` |

Manifest hashes use UTF-8 JSON.stringify of the corresponding stored PRESEAL
objects; individual file hashes use exact file bytes. Evidence files have separate
byte identities in EVIDENCE-SEAL.json; the seal's hash is in the final handoff.

## Frozen authority unchanged

`42e2529034a1a39d7c23945c3bfb22b228df180f` remains consumed HOLD27/70 and
peak>=3 violation, exact overall peak unknown. Candidate58be2d6c, author767b6729,
full882 package, original32+80 membership, full original limits remain fixed.
Observed346/11/18/3 and all422 obligations346/11/62/3 are unchanged.
Historical25DATA/68unrun and197PASS/1FAIL/1unsupported/7unrun remain historical.
REMAINING.json preserves all43 descriptors: movedtypes5, limits18,
adapters2 (real-scoped/mock-s3-scoped with P01/P06/P09/S41), mutants18; no DAV.
No actual candidate/build/compiler/native-oracle/private/network work, acceptance,
rescore, retry, new admission, superiority or completion claim.

Validation was scoped metadata/source integrity and staged whitespace checking,
not product tests. No unrelated staging, tracked files or root instructions were
changed. Final owned-scope cleanliness is checked after the evidence commit.

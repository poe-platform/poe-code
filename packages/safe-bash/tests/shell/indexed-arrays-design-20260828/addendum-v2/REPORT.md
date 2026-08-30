# Indexed arrays: response to eight open findings

**August 28, 2026 — additive design response, not implementation approval.**
Original `2cb93988`, preseal/addendum `abe53e03`, and independent `0d70a9d4`
remain byte-exact. Every G-ID below is the actual independent finding, not a new
test or a closed product defect. Detailed proposed mechanics and remaining gaps
are in `DECISIONS.md`; source/evidence hashes are in `BINDINGS.json`.

## Evidence boundary

Supervisor seal `f0c6321f506f866f37c42d4162dc332a80668925`; observations
`4e8f8a13590d489df5b5e7c70fe684de4abd2b5d`.
Manifest SHA256
`f731d304306b02d11df41b386d4528405ad307ca33098d25f1bc2a0193c0764f`.
Exactly N01–N16/1783 script bytes executed once: 14 exit0, N12/N15 exit127;
stdout3247 + stderr468 =3715 bytes. One five-byte file effect was captured before
deletion; peak four fixture entries. All children naturally exited/reaped; known
groups were absent at closure, no signals sent, fixture root removed.
Capture-time pre/post hashes and addition-aware censuses found no drift. **tests=0,
productCalls=0, productImports=0.** No native expected values/pass denominator.

Only pinned GNU5.3 on Darwin25.4.0/arm64 was observed, not Linux/full Bash,
asynchronous parent mutation, cancellation or resource behavior. Source anchors:
R=`c26892c3` runtime, B=`5137a74e` other files; accepted CD=`4641075d` is carried
in R. Runtime SHA256
`eb4588578001136b8ac011c1c458079b0c8a9f07e653938836d342dff052e193`.
This does not certify mixed HEAD, STACK or DOTGLOB.

## Accepted direction versus open decisions

Root now requires staged target publication, RHS evaluated once, no rollback of
already-observed RHS state/file effects, unchanged scalar assignment sequencing,
canonical indices0..2147483647 and existing exclusions. Fresh public Shell.exec
gets a fresh ledger; internal descendants/invoke share it. No cross-exec/RSS claim.

| Finding | Evidence/source anchors | Disposition and pending root decision |
| --- | --- | --- |
| G1 | R:1301; N09–N15 | Staging direction settled by root, not GNU. NEW lazy-cursor/phase table handles maximum-index empty and explicit append. Ratify statuses and static versus field-dependent overflow timing. |
| G2 | R:160,293,297,2342; N05–N08 | NEW charged, watch-owned absent identities; evict after final observer. Reserve restoration generations/ownership before publishing. Ratify storage costs and exhaustion ordering; no permanent name history. |
| G3 | R:278,794,817,824 | NEW whole-snapshot epoch validation, refusal without retry after intervening mutation. Ratify conservative cross-variable invalidation; full mutation-site coverage remains unproved. Native rows cannot close it. |
| G4 | R:135,2508,2525,2658 | NEW explicit expression/existing-Budget/private-ledger handoffs and owned tokens. No setter-only preallocation claim. Ratify ownership boundary; flat-string bridge remains unresolved. |
| G5 | B cleanup.ts:33,46; ACCOUNTING:59,72 | NEW additive prepaid release schedule and dependency-safe refcounts. No cancellable restoration admission. Exact large-string checkpoint guarantee remains open; no primitive-preemption claim. |
| G6 | R:29,62; B shell.ts:162 | Keep prior cap equations, lazy checked arithmetic. NEW private status1/continuation and diagnostic-budget proposal; root ratification required. Low-cap refusal is not usable-capacity or latency evidence. |
| G7 | R:1293,1379,1479,2331; N01–N08,N16 | Preserve scalar env, selection and effect phases. GNU export/local/prefix behavior does not ratify proposed restrictions; root must explicitly choose these intentional differences. |
| G8 | B parser.ts:6,274,439; R:309,824,2512 | NEW exact quote/operator/aggregate boundary. Preserve exclusions, bare indexed arithmetic refusal and scalar-only operators. Root must resolve bare-name operator policy versus historical N13 candidate; no grammar fixture freeze. |

**Final additive binding stopped closed:** the later metadata census found a new
`observation-review-v1` entry under the protected design root. Its contents were
not read. No ignore-list change, binding retry or native rerun occurred. See
`FINAL-STOP.json`; carried historical evidence is not fresh final-tree approval.

**All eight remain open for root disposition.** Highest remaining design risks:
snapshot mutation coverage, expression ownership/flat materialization, and exact
cleanup/checkpoint mechanics. No product/source/config/shared edits, builds,
tests, comparator or private-checkout work occurred. XAN hold is untouched;
alias/dotglob unchanged; runtime remains STACK-locked, DOTGLOB next. No further
native executions, retries or implementation are authorized by this packet.

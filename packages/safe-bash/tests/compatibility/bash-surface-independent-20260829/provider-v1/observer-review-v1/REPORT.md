# Observer review and durable historical STOP publication

## Authenticated observations — unchanged

The exact terminal receipt SHA256 40dcc85bebf86611540ab751fd6dfe0f78012bb50f9481700cd93d55d8695efe and every listed retained capture were authenticated before publication. SOURCE-AUTH.json binds all seven committed blobs in a1f98c3fad9601996ad7998d454e7b7bd611544d against live bytes and the historical preseal; no retained runner/helper was imported or executed. historical/TERMINAL-STOP.json is byte-identical. HISTORICAL-CAPTURES.json losslessly encodes the five authorized captures with original sizes/hashes. Empty raw output is encoded rather than acquiring a newline on publication.

Actual query PID22397 exited0, close observed, stdout EOF and stderr EOF observed, 4392ms; stdout exactly [] (2bytes), stderr0. Zero records returned by the sealed exact-token query is not absence of a denial, proof of log completeness, or permission-cause attribution. The query selected the authorized node(17408) message-token branch, not PID-only rows without that token. Twelve historical registered children have exit/close observations; registered active0 does not assert an empty OS process group.

The original disposition remains STOP_GROUP_RETIREMENT_UNKNOWN. No group recheck, signal, new query, target, fence, Bash, native, engine or product execution occurred in this review. No error detail is recoverable from the published markers. Old reservation remains halted; this publication uses a fresh grant and never edits old STATE or terminal bytes.

## Provable source defect and topology

At ../unified-log-v1/runner.mjs:25, the direct tool is spawned shell:false, detached:true, with ignored stdin and two pipes. At line35, after close, process.kill(-row.pid,0) is attempted. The ESRCH catch sets absent=true; every other exception emits only GROUP_CHECK_UNKNOWN. It drops code, name, errno, syscall and the distinction between an OS error and an unavailable/invalid ambient process binding. This information-loss defect is provable from source; OBSERVER-DATA.json demonstrates the non-injective projection on five hypothetical DATA inputs. It does NOT determine which input occurred.

The retained PID is a valid positive22397. There is no evidence here of a PID-sign mistake. Under documented non-Windows detached semantics, the intended group/session leader is the spawned child; a negative PID is consequently the intended group selector, not an arbitrary individual PID. [Node v22.17.0 detached/close documentation](https://nodejs.org/download/release/v22.17.0/docs/api/child_process.html#optionsdetached) is an adjacent-v22 public API reference, not authentication of this REPL's ambient process binding or the exact22.22.2 host implementation. The close event concerns child/stdio completion, not a census of detached descendants.

[Apple's archived kill(2) manual](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kill.2.html) describes signal0 checks and negative-PID group selection; ESRCH means no matching process/group, EPERM is a permission failure. This general platform description does not establish the actual errno or a Darwin25-specific code change. A successful check would mean a group was observed, not absence. An inconclusive catch must remain unknown. No host call is made to test these descriptions.

The source also depends on unqualified ambient process at the observer/termination sites; it never authenticates a callable trusted observer binding. That is a missing precondition, not proof that the ambient object was defective in this run. A thrown TypeError and an OS EPERM can produce the same retained marker. Do not invent either as the runtime cause. Group identity may outlive the direct child or be subject to reuse; a single observation is not a universal descendant census.

## Exact remaining repair — proposal only

1. New version only: record observer admission/binding identity and valid owned positive PID before its authorized use; do not enable a new global signaling capability merely to silence this failure.
2. Preserve a tri-state group result (present, absent, unknown) separately from known child exit, close, both EOFs and owned capture closure. Only the explicitly recognized ESRCH route may produce absent. Neither EPERM, EINVAL, missing callable, arbitrary throw nor successful return may be converted to absent.
3. In catch, retain bounded primitive error name/code/errno/syscall and thrown-value kind; omit stack, environment and arbitrary message/private data. Handle missing/malformed error properties without losing the primary disposition. Emit the observer attempt and result in chronological owner capture before finalization can fail.
4. Freeze DATA controls for success/present, ESRCH/absent, EPERM/EINVAL/unknown, unavailable binding, malformed throw, capture failure and ordering/duplicate closure; separately qualify an actual controlled child/observer only under a future root grant. This review does not implement or run that repair.
5. Publication/cleanup receipts must never overwrite the primary query STOP. This separate durable packet records the evidence deficit rather than re-scoring it. Unknown aggregate retirement stays unknown even when every directly observed handle is closed.

## Bash-only readiness feasibility

See BASH-READINESS-PROPOSAL.md. A future direct Bash target can decouple target-image startup from Node target startup; it cannot avoid macOS dyld or prove GNU5.3 behavior. The byte-identical historical fence explicitly authorizes process-exec only for the pinned Node path, so claiming that unchanged file permits /bin/bash would be false. Equivalent-policy executable/path rebinding needs an independently sealed profile delta and explicit root approval before execution.

## Publication scope

Only new observer-review-v1 files are added. Current fresh helper invokes only apply_patch and dev Git, with no signal/group-check operation; it does not import old helpers or reset old counters. New registered administrative children/EOFs and capture bounds are recorded separately from historical unknown group absence. SOURCE/DATA assertions are not provider/native passes. Native9/40 remain UNRUN. Existing dyld LIBIGNITION/code2 permission cause remains UNKNOWN. GNU5.3 source P2ff2ebe44 build remains paused as directed.

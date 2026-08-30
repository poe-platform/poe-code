# T1-r3 independent preexecution review

**Mechanism/control review: qualified ACCEPT. Requested 1,800-second activation binding: HOLD. No actual T1 GO.**

Source: `ba1721a99fdfe4954e187c57ae36d77fafac3a5a`. Execution preseal6,119 bytes SHA256 `8cfe3fc49116f9db553fa85a23683e711bc6766574780e6e33c25f5a6bf0e74a`. Authority279,865 bytes SHA256 `554f8aa10ff57f4ce3feb0be38dff63b21585aae6ca471e10b09f2a8d4031f8c`. Engine `72187e5abc1179883f85a63e1ef558f2e141c542`, transport `46611a5b67ad7af276154421ac7f50dd536ec570`, private package `fcf17fcb9682a8d3970f0ec3577807359ac03d437ad0d0f7e4fac36d1260f674`:12 source modules/24 emissions, unchanged product. This internal package is not a public complete-package acceptance or a private checkout.

## Blocking clock decision, not a silently repaired source

ROOT requested confirmation of a1,800-second future proposal. The actual packet deliberately proposes **2,100 seconds** in EXECUTION-PRESEAL/PROPOSAL and AUTHORITY-AND-LAUNCH.md. `supervisor.mjs:2` sets `performance.now()+2100000`; `data-support.mjs:14` accepts only a2,100,000ms grant. Independent R06 confirms that the1,800,000ms record is rejected and the2,100,000ms record accepted as DATA. No grant file was created or actual dispatcher launched.

Thus1,800s cannot be confirmed. ROOT must either approve the explicitly revised2,100s observation proposal in fresh authority, or request a newly sealed1,800s code/profile/grant-admission batch. Reducing the window can refuse later case admissions; no promise that every worst-case cell completes is needed. This review does not approve a larger budget. Both profiles remain observation/admission windows, not guaranteed OS process quiescence.

## Independent execution and preserved history

Reviewer preseal commit `694ccb0a4`, SHA256 `01284bbf49cdbeed762a9e164b7cf857589191694ff23955918d639ce894b4db`, preceded both controllers. Pinned Node112,989,184 bytes SHA256 `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011` was type/size checked and streamed in65,536-byte chunks before admission.

- **33 versioned purposes + eight rejection controls + ten additional groups PASS.** This is51 author purposes, not102 independent identities from repeated author runs. Positive receipt schema migration is explicit, not schema1 rescoring. The two no-close/exit-only schedules inside the ten are SYNTHETIC EventEmitter/PassThrough fixtures, not real Workers or uncooperative native processes.
- **Six independent groups PASS:** finite timestamp/domain neighbors; original C2 retained receipt; A03 digest/duplicate/entry/env/argv/workerData corruption; request-delivery/own-data faults; null-prototype valid records/sticky unknown; and the actual clock-admission mismatch. C2 reconciliation is one of these six, not an additional native success.
- **Three harmless original held-Node fixtures PASS:** clock-false, publication-undefined and timeout. All three independently observed exit/close SIGTERM; controllers exit/close0. Raw false/undefined remain exact in author assertions. Reviewer wrapper adds fixed spawn admission and independent exit/close observers; subject controller/helpers are unchanged. No normal-child rerun, no rescue and no unresolved known child.
- C2's original normal-child gate failure remains historical. Exact retained receipt SHA256 `9aefed73be3050238834b794a2c80de30e3a87c506bd9fcd2a451f6155d64f68`, PID34371, is accepted by the corrected gate **as DATA only**. Process close before the reviewer's stderr-close callback is allowed; exit and both pipe completions still precede retirement. No PID/group probe occurred.
- The original `24a2b1adf8e6acc83c6b5460c2fa1b21c4b573d7` HOLD and seven survivors remain unchanged. No actual Worker, matching, product/engine import, compiler, build, install, native oracle, network or private engine execution occurred.

## Receipt and ownership repairs

`receipt-gate.mjs:4–23` now uses finite own-data fields, bounded nonproxy arrays, safe integers, contiguous event sequences and nondecreasing microsecond timestamps. Owner and case clocks are separate domains; no cross-process clock comparison or inferred kernel chronology. Actual admission/PID/create/spawn/exit/close/EOF/retirement facts reconcile against flags; requested and successful posts have separate counters and ID binding. Unknown retirement, fabricated non-A03 nested observations and all eight malformed controls reject. No prototype-equality requirement is introduced; the independent null-prototype valid record passes.

The gate preserves the valid C2 ordering rather than demanding observer pipe-close callbacks precede the process close callback. It still requires both EOFs, both pipe completions and exit/close before retirement. Worker event producers now emit one stream completion, flag missing EOF as capture fault, and record post attempts separately from completed postMessage calls.

`owned-process.mjs:6–29` replaces the indefinite observation wait with TERM2,000ms, KILL, then1,000ms further observation. Missing retirement produces sticky STOP_UNKNOWN, incomplete/truncated capture, paused input writers, retained child and retirement promise. Synthetic eventual closure updates the separate retirement observation but does not turn STOP_UNKNOWN into success. The two synthetic schedules exercise this; real KILL/uncooperative OS behavior remains unqualified.

`supervisor.mjs:14,21` retains ownership before attempting its bounded emergency writes, then stops admission without next cell, archive/removal or ownership release. Emergency failure does not fall into the ordinary archive path. It attempts owner-stderr and EMERGENCY.json independently; raw primary references survive in owned state, while object diagnostics remain abbreviated. No force-exit masquerades as closure. The actual tool/process may remain alive with owned unresolved work beyond the observation window and requires fresh ROOT recovery authority; finite observation is not finite guaranteed OS retirement or guaranteed emergency persistence.

The existing SC01 logical accounting/native intrinsic-allocation exception remains unchanged. No refund, RSS/preemption or new matching behavior is proved by this harness review.

## A03 authority: exact request, not granted here

Ordinary requested Worker options remain operation shell-ere/version1, `env:{}`, `execArgv:[]`, owned stdout/stderr, old-generation128MiB/stack4MiB. Constructor-option checks are parent evidence only; actual effective values are still UNOBSERVED.

A03 replaces its owned entry with bootstrap SHA256 `04b6eecd850f38471d202a372eb777035d4a1b4cd020a52cb002c505ef323787`, preserves the original entry as `worker-entry.actual.js`, and imports that exact file. Future identity records bind the BOOTSTRAP URL/path in process.argv, empty effective execArgv and environment KEY NAMES, plus the selected workerData operation/version fields. No environment values are recorded. This is instrumented execution, not transparent original entry execution or proof of all possible workerData metadata.

ROOT must explicitly approve bootstrap imports **node:worker_threads (new workerData observation), node:fs, node:crypto, node:module, node:url, node:path**, confined by the bound source to adjacent manifest/load-log/identity files and the fixed engine graph. Inner edges are limits→node:timers/promises, validation→node:util, worker-entry.actual→node:worker_threads. No arbitrary URI/eval, foreign Worker, subprocess/network route, public test seam or inherited comparator/Node capability approval.

The externally bound nine-module set is errors.js, limits.js, matcher.js, syntax.js, transport/accounting.js, transport/protocol.js, transport/validation.js, transport/wire-engine.js and transport/worker-entry.actual.js. All three A03 expected name/hash/identity records are in MAP-AND-A03.json. The new gate checks cardinality, uniqueness and exact expected hashes, not merely nine syntactically valid rows. Non-A03 receipts require workerIdentity:null, nestedLoads:null and NOT_OBSERVED; their nested closure remains STATIC ONLY.

`AUTHORITY.json.externalOwnerEdges` lists owned-process→child_process/fs and receipt-gate→util. Full ROOT approval must ALSO cover the unchanged source-bound supervisor→fs/crypto/url/path/zlib and data-support→fs/crypto/path/zlib edges; the two-entry submap is not a complete external importer inventory. EXTERNAL-AUTHORITY-SOURCE.json records the full literal source list. All per-case parent/bridge edges remain separately bound. Synchronous parent hooks do not establish nested Worker tracing.

## Exact map and non-circular gates

Authenticated same-buffer archive:4,191 unique records,15,168,573 file bytes; compressed5,552,555 bytes SHA256 `75db992d80a47319fc3a2bd86897e0c4540c1e268b58ab07c2be898ae89dfd2b`; decoded20,972,257 bytes SHA256 `aeef06371cd550d6e3a61e4003dce2ddcb873861f0bd9607ac29c8e44593c597`. Inventory SHA256 `60479454833b1c6431414b3cf8685d1ef5ce288e9f9100c014914feeda351c48` and all cell file bindings checked. No case materialization/execution was performed; author materializer was inspected as source.

**47 eligible =44 common×three layouts +three named-layout A02 variants =135 cells,45/layout.** Twenty-four no-Worker cells leave111 planned Workers. Thirteen deferred variants stay explicit; all60 runtime variants are UNRUN.

Seven public gates: B01/root-descendants→R27/R28/EH05; B02/fresh-independent-exec→R28/EH03; C01/readonly-capture-target→R25; C02/public-expansion-limit→EH03; C02/public-output-limit→EH03; C02/sink-raw-false→EH03/EH04; C03/short-circuited-regex→EC09/EH01. These are purpose anchors plus required host-bound supplements, not proof the existing rows already measure scheduler/ledger/Worker effects. They gate corresponding CORE70/final claims, not creation of a public integration candidate.

Six nonpublic gates: L07/messageerror; B07/capture-byte-overflow; B07/capture-slot-overflow; A01/expr-contract-pins; A04/positive-new-method; A04/negative-old-union. Each precedes its relevant acceptance claim; they do not create a circular full60-first prerequisite. A synthetic messageerror proposal is not a native event proof, and B07 must establish that an earlier limit does not hide the intended boundary. Public declaration/legacy Expr consumers need their actual separately bound public closure. None is waived or run here.

## Future slots and caps

Confirmed packet proposal: **146 known OS =135 sequential case Nodes +one owner +ten administration; peak3. Workers111 cumulative/peak1. Native helper-thread totals unknown. Capture64MiB/work256MiB**, stream64KiB/receipt128KiB/A03 load-log64KiB plus identity8KiB within the existing margin. These are bounded logical/profile claims, not a kernel quota. No permission flags or ambient NODE_OPTIONS are silently inherited.

**Clock not confirmed at1,800s:** current packet uses2,100s, case10s +TERM2s +observation1s, publication reserve180s. ROOT clock decision/reseal is required first. Then approve complete importer authority, fresh exact ROOT-GRANT schema1/authorizedtrue/runId ERE-PRIVATE-RUNTIME-v3/profile hash, all135 current case trees, actual command and fresh exclusive captures/parents. Non-login pinned shell→env-i→pinned Node→supervisor with PROFILE_SHA/ROOT_GRANT_SHA remains prospective. Initial trusted shell startup is outside cohort capture; no claim login:false suppresses every startup file. No actual grant, activation or deadline renewal is supplied by this review.

Reviewer role/capture records are separate from source assertions and synthetic schedules. Generated owned copies are archived before removal, original artifacts preserved, explicit scoped commits only. Final publication roles are reported separately from the raw snapshot; no group absence/universal census is inferred.

## Supplemental source bindings and reviewer accounting

SOURCE-BINDING-CHECK.json reconciles all26 execution-preseal constituents:25 available byte records match their declared size/hash; the derived CASE-INVENTORY binding is checked by the executed same-buffer decode in review.mjs. CORE70-SOURCE-MAP.json separately authenticates the exact21,146-byte CASEMAP at the candidate commit, SHA256 `6437a80825871347d82e9b1d8f4208ffd69ed612a1d4ee23818f0332f01f6625`:70 rows, ALL_UNRUN. R25/R27/R28/EC09/EH01/EH03/EH04/EH05 anchor purposes were inspected, not executed. This establishes the map reference, not an accepted CORE runtime closure.

The review uses two controllers and three real harmless fixture children, below the4+4 ceilings; synthetic EventEmitter PIDs are not OS starts. Development patch shell/tool roles, five initial Git roles, two preseal Git roles, two map-authentication Git roles, final scoped metadata and final publication roles are included in the receipt's known-role accounting. File-backed captures record actual controller/fixture exit and close; development patch tools have separate tool completion records. No full transitive process census or group absence claim is made. The pinned Node tool is preadmitted; no compiler/parser qualification is repeated. This review's overall20-minute/48known-role/peak3/64MiB-capture/384MiB-logical-work grant is distinct from the pending actual T1 proposal.

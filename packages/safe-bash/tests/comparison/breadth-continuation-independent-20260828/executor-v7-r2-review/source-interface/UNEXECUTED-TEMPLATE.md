# UNEXECUTED-TEMPLATE — conditional one-admission interface

**BLOCKED. Do not run, issue or consume authority from this document.**
This is a description of inspected source, not a positive JSON review receipt
or usable grant. Root needs the separate composed/DATA verdict and combined
review first, followed by an explicitly authorized fresh one-attempt grant.
No historical token authorizes this invocation. No real AUTH.json is created.

## Exact version and byte bindings

- Executor author commit:`5110550da057398fffd1fb77bf538121c67c731f`.
- Handoff evidence:`8fc39a531780c8c9f50072e6c068068dd721cddd`.
- Recipe SEAL.json:93967 bytes/0644, SHA256
  `b19d04354088d31ac387c82606aaa0a7ce64cf26efd0ffbebcfc4f4e5969a03c`.
- INTERFACE.json:10754 bytes/0644, SHA256
  `33e2c6ca9213f10645f2421e7390a2451d8e320d34cdfe3746366efffb1286b7`.
- Admission phase-projection hash:
  `03463349729bdd298b0ff3ca8c1066c568daad4d5049532e957ce825374ce475`.
  This is SHA256 of compact JSON with ordered keys limits,command,phase,operations,
  phase admission and operations plan.admission. Raw OPERATION-PLAN.json is
  33346 bytes, SHA256
  `4112bb1cf2da78344f8b20eef82e0709f95b33067d6e07b610d66a22a12c9ff4`.
- Product candidate:`67eab12e315054907ef4ef435c6bbca2f59e0c36`; pack SHA256
  `6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06`.
  Comparator pinned just-bash3.4.2, not latest. Metadata authentication only.
- Future entry is r2 launch.mjs:2584 bytes/0644, SHA256
  `928900c9e495763a45ac2a9860aec6b3d3d82a679ea9649eb72a2c1481bf20ed`.
  Inner coordinator.mjs:1819 bytes/0644, SHA256
  `766b6ca082c28e91b8e5c80b0a83775d0d6777572e213ae271de5990c19d371c`.
  Author launcher32581a276c50d73aab987880518ce04b77f5c631 is a DIFFERENT,
  already-used synthetic test launcher, not this command.

## Required immutable review receipt — schema only

After combined acceptance, a separately committed immutable review document
must have exactly three enumerable own-data fields, no extras or accessors:

| Field | Required type/value, not an issued receipt |
| --- | --- |
| role | primitive string different-reviewer |
| verdict | primitive string PREEXECUTION_ACCEPTED, only after combined verdict |
| recipeSha256 | primitive64-lowercase-hex string equal to the exact recipe above |

The SOURCE/DATA report alone does not satisfy this prerequisite. Richer review
metadata belongs outside this closed document. No such JSON is supplied here.

## Root grant fields — schema only

The fresh root grant must be a separately committed immutable document with
exactly these thirteen own-data fields. Placeholders below are deliberately
invalid and cannot be passed as authority:

| Field | Conditional required value |
| --- | --- |
| role | root |
| phase | admission |
| attempts | numeric integer1 |
| runId | `<FRESH_ROOT_RUN_ID>`, primitive string matching `[a-z0-9-]{1,64}` |
| outputRoot | exact absolute r2/runs/`<FRESH_ROOT_RUN_ID>` path |
| recipeSha256 | exact recipe SHA256 above |
| reviewSha256 | `<EXACT_COMMITTED_COMBINED_REVIEW_SHA256>` |
| planSha256 | admission phase-projection hash above, NOT raw-plan file hash |
| bootstrapProfile | JUST_BASH_3_4_2_UNAVAILABLE_BOOTSTRAP_V1 |
| reportProtocol | BOUNDED_TERMINAL_V3 |
| candidate | product candidate40-hex above, not executor author commit |
| packSha256 | exact pack SHA256 above |
| command | exact own-data object with ordered entry,phase,runId,nodeArgs fields |

Command values are coordinator.mjs, admission, the same runId, and a dense
two-element primitive string array in this exact order:
`--unhandled-rejections=strict`, `--max-old-space-size=256`.
An admission grant must NOT contain acceptedAdmission. No cohort is authorized.
Role strings and immutable Git bindings are not cryptographic caller identity.

## AUTH envelope and inert launch shape

Future AUTH file: absolute path under
`/Users/kjopek/Workspace/safe-bash/tests/comparison/breadth-continuation-20260828/executor-v7-r2/runs/<FRESH_ROOT_GRANT_NAMESPACE>/AUTH.json`;
regular non-symlink leaf,0644,1..65536 bytes, exact SHA256 passed on argv.
Envelope fields are exactly review and grant. Each reference has exactly commit,
path,sha256: primitive lowercase40-hex immutable Git commit, primitive repository-
relative path<=4096 code units without dot/dotdot/empty/backslash/NUL/instruction
segments, and primitive lowercase64-hex exact document hash. Both documents
are loaded by separately observed Git metadata children. No placeholders work.

The following is **inert documentation only**. Quoted angle-bracket placeholders
are invalid; replacing them requires a separate root decision, not this review.

```text
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --unhandled-rejections=strict --max-old-space-size=256 /Users/kjopek/Workspace/safe-bash/tests/comparison/breadth-continuation-20260828/executor-v7-r2/launch.mjs admission '<FRESH_ROOT_RUN_ID>' '<ABSOLUTE_AUTH_JSON>' '<EXACT_AUTH_JSON_SHA256>'
```

The bound Node executable is112989184 bytes/0755, SHA256
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
The launch authenticates process.execPath, recipe, tools and AUTH; supervises
coordinator with stdio ignore/pipe/pipe/pipe; and repeats integrity checks after
settlement. Body output is r2/runs/`<FRESH_ROOT_RUN_ID>`; outer collector is
r2/runs/`<FRESH_ROOT_RUN_ID>-supervision`. Both must be fresh, never overwrite old
attempts. The authorized invocation is once, not permission to retry failures.

## Required observed receipts, not promises

- Successful launcher record schema BREADTH_V7_LAUNCH has exactly fields schema,
  qualified,unsafe,reference,summaryReference,children,actualRawRetainedOnly.
  Qualified must be true, unsafe false; reference binds COORDINATOR-RECEIPT.json,
  summaryReference binds OUTER.json; each reference is path,bytes,sha256,mode.
  Launcher children contain pid,group,reaped,exit,close. Success stdout alone is
  not acceptance: preserve natural outer disposition and bound raw receipts.
- Supervisor receipt fields: pid,exit,close,reaped,failures,signals,records,
  captureBytes,stdout,stderr,rawRecords,natural. Exact exit/close code0/null signal,
  natural=true,reaped=true, no signals/failures/truncation/stderr required.
- BOUNDED_TERMINAL_V3 terminal fields: schema,mode,runId,status,unsafe,exitCode,
  primary,result,launchAccounting,children,failures,historicalScoresUnchanged.
  Require ADMISSION_ACCEPTED, unsafe=false, exitCode0, absent primary, exact
  accounting and persisted/reaped children, no publication failures.
- Final FD3 report fields: mode,runId,status,unsafe,result,children,
  allChildrenReaped. Here children is an integer, NOT an array. It must equal
  terminal/ledger/accounting/planned operation count. The other fields must
  agree with terminal and authenticated RESULT.json.
- Exactly two ordered authority events before final: event fields sequence,
  kind,receipt; sequence0(review),1(grant), kind authority-observed. Receipt fields
  role,ordinal,reference,pid,group,status,signal,errorCode,stdoutBytes,stdoutSha256,
  stderrBase64,reaped. Production role is git-authority-metadata, ordinals1/2,
  exact references/hashes/bytes, positive PID/negative group, status0/null signal/
  null error, empty stderr and reaped=true. Final artifact must agree with these
  actual observer records; synthetic-authority-metadata cannot stand in for it.
- Worker ordinary rows require natural0. Intentional C09-status7 and completed
  C09-deadline TERM-negative roles remain explicit and must have exact ledger
  fields/dispositions. No blanket all-zero replacement of negative evidence.

## Conditional scope and remaining blocks

Actual interface plans **14 workers**, cap**27**, concurrency1, **two later C11
empty-setup calls**, **zero semantic calls**. These numbers exclude launcher,
coordinator and separately accounted Git metadata processes;27 is not a global
OS-process count. This review performed none of them. The99 semantic cohort
requires separate authorization after qualified admission and is not released.

Config cap**2097151 including LF**; separate STAGED cap**2097152**. Logical
documents**33554432 (32MiB)**, physical records262144, each stdout/stderr65536,
metadata stream262144. Body**260046848 (248MiB)** plus collector**8388608 (8MiB)**
=268435456. **All full logical/quota bounds remain STATIC_ONLY, not RSS**.
256MiB old-space is not RSS. Child deadline30000ms, TERM2000ms, KILL1000ms,
outer checked4500000ms: no hard preemption guarantee. No full-pressure test ran.

**Blocking prerequisites:** separate current composed/DATA verdict; root combined
acceptance; separately committed exact positive review receipt; explicit fresh
root grant and hash-bound AUTH; fresh outputs; still-matching359 recipe inputs,
including seven materialized historical prerequisites and two bound tools.
Real production Git authority/worker, engines, staging/C11 and one admission
remain unexecuted, not silently replaced by metadata stubs. Bootstrap remains
the narrow unavailable module/worker_threads profile, not stock Node; W07
remains UNQUALIFIED/UNCREDITED. No caller-authentication, native/private/network,
full-gate, superiority or goal-completion claim is authorized.

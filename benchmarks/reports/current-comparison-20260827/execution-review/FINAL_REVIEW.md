# GO — execution bridge only, R1/R2 independently closed

2026-08-27. This supersedes the decision, not the evidence, in `REVIEW.md` and
`STATUS.md`. The initial HOLD, four failing adapter records, original verifier
and original280-file author manifest remain unchanged. No product score or ROOT
candidate approval is implied.

## Source and checks

Only existing author runtime change: `execution/expanded.mjs`, SHA256
`761bf2422d03f5dcc6162df7d42e1d2fd2bb974ec2e42b9fe0d51e3e406fe3e2`.
Revision SHA256: `7540c6b0bdd8532ca0d8e937cc4aefc865ae5b70c11b8690fcd47ba0ab6ea276`.
All289 current author files match their original/additive bindings before and
after fresh review; both tree digests are
`fbb619d63d7c135f1ba28a21ce7f5c068be81fc0038eb8a55bcce6167e00b7c0`.
`FINAL_RECEIPT.json` binds the15 runtime files and exact evidence inventory.

- **Fresh:**4/4 independent typed-byte probes cover both engines and both TMPDIR
  profiles. Snapshot completion follows the real VFS byte read and exec settlement;
  final raw bytes are unprojected, scored bytes/VFS retain historical projections.
  Plain Uint8Array NUL/invalid-UTF8/high bytes and deliberately wrong public text
  distinguish bytes from text. Baseline stderr remains its documented UTF-8 public
  text boundary, not recovered original bytes.
- **Fresh:**12/12 existing adapter probes,14/14 real sentinel expectations,8/8
  binding refusals and9/9 static/CLI checks. Four expanded scored records also
  match their initial-HOLD captures exactly; helpers/recipes/goldens are unchanged.
- **Historical, not fresh:**initial review14 sentinels passed their expectations
  but four expanded adapters failed. Author28-sentinel receipts and author R1/R2
  regression records are retained separately, not counted as independent reruns.
- Fresh evidence: `attempt-002-r1-r2/summary.json`, `typed-raw-controls.json`,
  `adapter-controls.json`, raw sentinel captures and source-before/source-after.
  Command: `node benchmarks/reports/current-comparison-20260827/execution-review/verify.mjs attempt-002-r1-r2 --r1-r2`.

## Cleanup and limits

Fresh managed workload:14 coordinator children,14 engine children,1 extra Node
descendant,1 explicitly created sentinel Worker,3 CLI children and1 reviewer driver.
All14 groups and the extra descendant are absent at final census; CLI children
returned normally. Eight negative attempts used SIGTERM, none SIGKILL; forced
cleanup never became a functional pass. Two clean positives and three clean
wrong-result failures remain distinct from nine lifecycle/capture/binding failures.
Counters exclude read-only inspection commands and unenumerated Node loader threads.

Actual product imports/main cases/native captures/network sockets/installations/
performance trials:0. No product, root, private, preparation or other-owner edits.
Process groups are not universal host-work tracking; heap limits are not RSS caps.
Actual candidate API compatibility, optional runtimes, curl and unshadowed dispatch
remain unmeasured. No universal module-evaluation or provider claim is made.
The explicit owned-file whitespace check reports zero warnings in `WHITESPACE.json`;
no copied evidence was reformatted. A metadata-only index read exceeded Node's
default capture buffer before staging; its retained admin receipt records the
bounded32MiB retry. No product/sentinel cap changed.
The precommit guard also stopped on an unrelated owner's concurrent commit;
that event is retained, and final commit checks use a fresh outside-index baseline.

## Executable handoff and remaining inputs

Safe now: `node benchmarks/reports/current-comparison-20260827/execution/run.mjs PREPARE`.
PREFLIGHT/MEASURE without ROOT bindings exit2 before product imports. After ROOT
supplies and authorizes the exact inputs in `execution/BINDING.md`, the implemented
command is:

```sh
/ABSOLUTE/APPROVED/NODE benchmarks/reports/current-comparison-20260827/execution/run.mjs MEASURE \
  --binding /ABSOLUTE/root-execution-binding.json \
  --root-receipt /ABSOLUTE/root-execution-receipt.json \
  --root-receipt-sha256 ROOT_SUPPLIED_RECEIPT_SHA256 \
  --output /tmp/NEW_NONEXISTENT_ATTEMPT_DIRECTORY
```

Still absent: ROOT candidate commit/tree and source bytes/hash; accepted public
pack/hash and source/inventory/consumer/different packed-review qualification;
approved Node artifact; both exact public package closures/entries/locks/assets
and baseline authenticated tar; breadth heap policy; contained host cwd/HOME/TMPDIR
and allowlisted env; current15-file runtime binding plus cohort seals/profiles;
ROOT execution receipt/hash binding those inputs (`timingAuthorized:false`).
No new signing system or12-document prerequisite. Existing accepted receipts may
supply these bindings. Captured-golden replay does not require live native tools
or new24/tree/file holdouts. Planned896 expanded and136 breadth outcomes remain
separate; seven breadth diagnostics are unscored. Stop at this bounded handoff.

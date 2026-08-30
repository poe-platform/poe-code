# Independent bridge verdict: HOLD

Subject: stopped author delivery, not Candidate70. Start with `STATUS.md`.
Author MANIFEST SHA256: `8a2130dfee34309ee5f5eb28869948e02a690c2f5e90031aa8693415b0c85b9a`.
All280 files verified before and after; both tree digests are
`6e89b6f7896fca23606d4ffdf9a278a32dec03f7755deb27d9426cddcbc744c9`.
Exact per-file bytes/hashes: `attempt-001/source-before.json` and `source-after.json`.
The first independent failures, console log and raw captures are retained unchanged.

## Required narrow corrections by the author, not applied here

**R1 — blocking lifecycle phase defect.** `../execution/expanded.mjs:35` emits
snapshot-complete before exec-settled and before the snapshot for virtual-bash.
The baseline branch omits snapshot-complete entirely. Both original/aligned
profiles reproduce this. `../execution/supervise.mjs:142` requires the predecessor
phase; its final completeness check also requires snapshot-complete. Thus otherwise
successful expanded observations cannot satisfy this supervisor. Move that marker
to actual snapshot completion for both branches, preserving fixture/predicate logic.
The author28 synthetic checks do not exercise observeExpanded: their synthetic
branch manufactures its own correctly ordered phases. Evidence is all four
expanded rows in `attempt-001/adapter-controls.json`.

**R2 — missing/misencoded supplemental raw capture.** The final expanded observation
does not contain `raw` on either engine, despite README/DIFFS promises. The unused
inner virtual expression also encodes `result.stdout`/`result.stderr` strings,
not public byte arrays. Keep unprojected converted channel bytes in the final
observation; do not change the historical scored four-field comparator. These
synthetic probes preserve NUL/high bytes in scored stdout and VFS content; this
finding does not allege product or internal-pipeline byte corruption.

Affected adapter SHA256:
`25e95bcfd43594fc95d4a0a0ef3c4d258bd078a9d357ef38c893a5f0c0146d91`.
Supervisor SHA256:
`5930f48aba28df735e3862f1b283b5d774fd0f4d55c81990c0f48f69a8f2df8a`.

## Minimal reproduction, synthetic APIs only

From repository root, this invokes only the author's adapters with the reviewer's
in-process fake public API objects. It runs no product, native tool, network or
child. It prints the four failing expanded phase/raw records:

```sh
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { adapterControls } from "./benchmarks/reports/current-comparison-20260827/execution-review/adapter-controls.mjs";
const root = process.cwd()+"/benchmarks/reports/current-comparison-20260827";
const profiles = JSON.parse(readFileSync(root+"/cohorts/profiles.json"));
const rows = await adapterControls(root+"/execution", profiles.breadth);
console.log(JSON.stringify(rows.filter(row=>row.issues.length), null, 2));
process.exitCode = rows.some(row=>row.issues.length) ? 1 : 0;
'
```

Full bounded reviewer reproduction, if separately requested, uses
`node benchmarks/reports/current-comparison-20260827/execution-review/verify.mjs attempt-002`.
It refuses to overwrite prior evidence and requires the stopped handoff/manifest.
Do not reuse this review for any changed author source.

## Independent checks and cleanup

- 14 real sentinel attempts:2 naturally clean positives;3 clean-but-wrong
  stdout/VFS/status failures;9 lifecycle/capture/binding failures. All14 controls
  satisfied their expected decision, not14 functional passes. Five used SIGTERM;
  none needed SIGKILL. New Worker-leak and descendant-pipe controls produced
  correct observations but remained failures. `sentinel-06-*` and `sentinel-07-*`
  retain their raw result, phase/exit/close history, PIDs and cleanup evidence.
- 14 coordinator children +14 engine children +1 extra Node descendant;1 explicitly
  created sentinel Worker;3 CLI PREPARE/PREFLIGHT/MEASURE children;1 reviewer driver.
  These are managed review-workload counters, not all read-only inspection commands
  or Node loader/runtime threads; the raw summary's workerThreads field counts
  the explicitly created sentinel Worker only.
  All14 groups absent at final census; the extra descendant is absent. Scope is
  owned process-group/child evidence, not universal host promise or thread tracing.
- 12 in-process fake-library adapter invocations:4 expanded failure records and
  8 breadth default/javascript/python/sqlite wiring probes without detected issues.
  The latter do not establish installed optional-runtime usability or real API
  compatibility with an unprovided candidate pack.
- 8 binding negatives refuse synthetic3.4.2 entry masquerading, source/pack/profile/
  receipt rebinding, changed asset, traversal and symlink. The fake3.4.2 rejection
  specifically reaches the authenticated public-entry SHA check, not an unrelated
  parse error. Synthetic receipts are test input, never ROOT execution authority.
- 9 static/CLI checks verify exact selected recipes and both golden profiles,
  unchanged helper Git bytes, distinct5s/28s and30/120-within50/140 envelopes,
  clean closure membership, and unbound PREFLIGHT/MEASURE exit2 before any product
  import. Native-golden equality is used, not historical baseline agreement.

## Boundaries retained

896 expanded observations and136 breadth outcomes are planned, not executed.
Breadth remains54 targets+7 controls+7 unscored diagnostics; there is no union score.
Original omits explicit TMPDIR and /tmp setup; aligned supplies both. Exact stdin,
cwd/env, file setup, constructor/exec options and legitimate optional flags are
preserved in the inspected adapters. No handler replacement or synthetic command
registration is introduced. Actual unshadowed dispatch remains **unmeasured**;
the bridge expressly omits instrumentation rather than asserting completeness.

Read-only inspection finds explicit host env, public root resolution, member hashes,
no ambient/private runtime fallback and appropriately qualified main-realm loader
events. It is not all-module evaluation or a host-JavaScript security sandbox.
Curl code retains bounded numeric loopback and historical breadth fixed-port
behavior; no network was opened or live curl behavior certified by this review.
Captured native goldens need no live oracle or new24/tree/file qualification.

No product imports/main observations/native captures/timing trials/installs/private
access/du work/author edits/commits. Author historical raw failures are untouched.
No fixes or extra gates are proposed beyond the two localized defects and their
source-bound recheck. Stop here; ROOT candidate SHA/pack remain unprovided.

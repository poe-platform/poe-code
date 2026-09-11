# #664: retire completed shell-owned cleanup registrations

## Status and ownership — September 8, 2026

Implemented and focused validation complete after root opened the source writer
window following its successful full gate and #658 delivery at `dac2c88de`.
Preparation against frozen HEAD `6a2f1f16f` changed only this plan and authorized
temporary evidence/patch files, preserving canonical source/test bytes throughout
that gate. The #657 audit and delivered #663/#665 work are unchanged.

Final explicitly authorized writer scope:

- `packages/safe-bash/src/shell/cleanup.ts`
- `packages/safe-bash/src/shell/runtime.ts`
- `packages/safe-bash/src/shell/arrays/state.ts` — separately granted by root:
  StateMonitor owns the retained callback and its successful close boundary.
- `packages/safe-bash/tests/shell/cleanup-retention.test.ts` — new dedicated test.
- This plan. Root retains canonical test inventory, Git, build, lint and delivery.

All five owned files are frozen for root integration. No leaf Git, build or lint
command, broad gate, native fallback, other-worker edit or #667 work. The existing
public-cleanup test creates and removes its own maintained source-bound snapshot;
that test is recorded separately from the memory-only dedicated regressions.

## Pre-fix current-code reproduction

Temporary executable: `/tmp/kamilio-664-retention-20260908-01.test.ts`.
It imports current repository modules, uses MemoryFileSystem and literal bounded
loops, and observes registration/cleanup completion without changing admission,
cleanup outcomes or signals. It tracks root and all-scope registrations, not
just a cumulative registration counter. No heap/RSS, GC, timing or OOM claim.

Within one public Shell execution, sample before work and after 16/64/128
completed iterations, while a probe command is still running:

| Shape | Root callbacks: initial / 16 / 64 / 128 | All scopes |
| --- | --- | --- |
| `: >out` | 4 / 20 / 68 / 132 | 5 / 21 / 69 / 133 |
| `: \| :` | 4 / 68 / 260 / 516 | 5 / 69 / 261 / 517 |
| `(:)` | 4 / 20 / 68 / 132 | 5 / 21 / 69 / 133 |

All counts return to zero after execution, including the probe's command scope.
The last pipeline sample attributes 256 callbacks to InvocationCancellationOwner
and 257 to StateMonitor (one root monitor plus 256 completed stage monitors).
Redirects retain 128 output cleanup hooks; subshells retain 128 extra monitors.
The other three root callbacks are root admission and session owner/value drains.

A separate parent command awaits 16 then 64 child invocations with a borrowed
local signal. Root registrations remain 4, but all-scope registrations grow
5 / 21 / 69 until the parent returns. This prevents a root-only fix from passing.

Final temporary run: **18 tests, 12 pass, 6 fail, 0 cancelled/skipped**. Four REDs
assert completed-owner counts return to the pre-work baseline; two REDs require
the new internal per-registration retirement API. The 12 passing controls cover
public hook return shape, six falsey/aggregate cases, three redirect cooperative
barriers, and two local-child/root-abort barriers. These are temporary evidence,
not canonical test membership or a candidate GREEN result.

Harness corrections are not product failures: static imports from `/tmp` first
selected CommonJS through an existing `/tmp/package.json`; dynamic ESM imports
in a before hook fixed that without changing that file or source. An attempted
arithmetic-for witness was unsupported and replaced with literal list-for loops.
An optional capabilitiesFor method cannot be mocked before it exists; the stream
fixture now supplies that optional hook on its own in-memory instance. Its
truthful narrower randomAccessWrite=false profile selects streaming output.

## Implemented ownership API

1. Change internal `InvocationScope.register(cleanup)` to return an idempotent
   `() => void` retirement handle. Store callbacks in an insertion-ordered
   `Map<symbol, InvocationCleanup>`, with a unique key for every registration.
   Equal callback functions registered twice remain two independent obligations.
   The handle deletes only its key; it neither invokes cleanup nor awaits work.
   It is safe after closure and does not retain the callback through its key.
2. At drain start, snapshot callback values and clear the map before invoking
   any of them. Retirement cannot suppress another callback already in this
   snapshot or cancel running cleanup. Preserve existing all-callback drain,
   child close, tracked-work wait, falsey failure recording, finalizers and child
   removal. Do not turn the registry into a deduplicating Set of functions.
3. InvocationCancellationOwner stores its parent's retirement handle. In the
   existing finish/abandon finalization paths, resolve `finalized`, then retire.
   Do not retire on requestClose, capture, signal abort or merely starting finish.
   Preserve boundary closing, outcome/provenance selection and failure channels.
4. StateMonitor stores the handle for its independent root/session callback.
   Its existing synchronous closeValues closes both value stores successfully,
   then retires and clears the handle. If a close throws, leave the callback
   enrolled for existing fallback/error handling. Do not remove monitors from a
   snapshot session's monitor set: that set also owns array-binding cleanup.
5. Give each shell redirect output a child InvocationScope before calling
   openFileOutput. Forward registerCleanup into this child. Await child.close
   after target.finish/abort, including failure and setup failure, and release
   the existing file reference/path-cache suspension in finally. The existing
   idempotent output-operation close is drained; a completed child removes itself
   from its parent. This avoids retaining completed outputs at the root and keeps
   failed or still-pending host work enrolled until its real cleanup settles.
6. Public CommandContext registerCleanup adapters explicitly discard internal
   return values. Do not accidentally expose the retirement handle to plugins
   by changing an expression-bodied forwarding function's runtime return value.
   No public host contract or OutputOperation API change is necessary.

## Await-cycle review and compatibility constraints

- Existing local invocation chain: parent.close starts its owner hook and child
  scope close concurrently; owner hook awaits owner.finalized; owner.finish awaits
  child.close, then selects outcome and resolves finalized. Never make finish
  await parent.close, and never register the owner hook in that same child scope.
- Pipeline owner.finish receives an already-resolved barrier after the stage's
  existing command/resource cleanup. Retirement happens only after finalization.
- StateMonitor's fallback callback awaits session.scope.drainWork. Calling that
  callback from an active command's closeValues would wait for the command itself.
  Retirement must only unlink after the existing synchronous store closes, not
  call/await the fallback callback. Keep finishSnapshot-before-snapshotScope.close
  ordering unchanged; do not add a finish promise to its own drain barrier.
- Redirect child.close awaits the already-owned output operation, not the command
  or cancellation owner's finish promise. Root closure may start it concurrently;
  existing shared close promises keep the host-cooperative barrier intact.
- Preserve raw undefined/null/false/0/empty-string failures, registration order,
  duplicate registrations, drain-all behavior, finalizers, root-caller precedence
  and local/pipeline cancellation provenance. Do not clear failure arrays, weaken
  diagnostics/assertions or replace falsey presence checks with truthiness.
- Moving redirect cleanup into its real lifetime can surface cleanup failure
  before final root drain. Validate existing status, suppression, primary-error,
  setup-failure and delayed-host controls; do not declare this risk harmless by
  assertion. Never silently detach a failed cleanup just because finish rejected.
- This repairs completed shell-owned callback retention within an execution, not
  all object/array ownership retention, a universal cleanup-memory budget, forced
  cancellation of opaque host promises or sandboxing of trusted plugin JavaScript.

## Prepared patches and TDD history

- `/tmp/kamilio-664-tests-20260908-01.patch`: adds the dedicated canonical test
  using ordinary relative ESM imports; same 18 test bodies as temporary evidence.
- `/tmp/kamilio-664-production-20260908-01.patch`: minimal changes to cleanup.ts,
  runtime.ts and arrays/state.ts. All 13 ordered old-context hunks were checked
  against current source without applying or executing transformed source.
- After writer grant, applied only the canonical test patch first. Fresh canonical
  RED reproduced exactly 12 pass / 6 fail. Implementing cleanup.ts/runtime.ts
  yielded 16 pass / 2 fail, isolating the remaining monitor retention. Only after
  root explicitly granted arrays/state.ts did that final change land: **18/18
  dedicated GREEN**, with no assertion weakening or test-body change.
- Redirect, pipeline and subshell probes now each remain root=4/all=5 at baseline
  and after 16/64/128 iterations. Local-signal child invocations likewise remain
  root=4/all=5 after 16/64 children; every execution ends root=0/all=0.
- All prepared patches are historical preparation artifacts, not patches to
  reapply to the now-implemented source. Build/type integration and delivery
  remain root-owned; focused runtime passes do not claim those gates passed.

## Final focused validation

All runs used Node v22.22.0, TSX_DISABLE_CACHE=1, NO_COLOR unset, the requested
TMPDIR, and the maintained test reporter. Canonical runs used package CWD.
**400 tests passed across 16 focused files: 18 dedicated + 382 adjacent; zero
failures, cancellations or skips in final successful runs.**

| File under packages/safe-bash/tests | Passed |
| --- | ---: |
| shell/cleanup-retention.test.ts | 18 |
| shell/invocation-cleanup.test.ts | 23 |
| shell/invocation-cleanup-lifecycle.test.ts | 21 |
| shell/invocation-cleanup-pipeline.test.ts | 17 |
| shell/invocation-cleanup-public.test.ts | 16 |
| shell/input-return-cleanup.test.ts | 56 |
| shell/redirect-limits.test.ts | 28 |
| shell/pipeline-effects.cases.ts | 2 |
| contracts/filesystem-output.test.ts | 26 |
| contracts/filesystem-output-descriptor-stream.test.ts | 37 |
| contracts/filesystem-output-task-reactions.test.ts | 38 |
| contracts/filesystem-direct-output.test.ts | 23 |
| shell/value-state.test.ts | 37 |
| shell/invoke.test.ts | 6 |
| shell/cancellation-stage2-author-20260827/runtime-v1/runtime.test.ts | 5 |
| shell/indexed-arrays-author-20260828/foundation.test.ts | 47 |

The first public-cleanup attempt failed its shared setup with EROFS because the
required TMPDIR was read-only in the sandbox (all 16 cases failed the same hook;
not a product assertion). The first escalation review timed out; the permitted
retry ran successfully: 16/16, including normal/early-pipe/caller-abort/sibling
native-resource retirement and refusal controls. Its binding profile was
captured-working-tree-not-committed-qualification; its after hook verified and
removed the snapshot. No hidden pass, committed-delivery or full-gate claim.

Temporary run command (Node v22.22.0; uncached; NO_COLOR unset):

```sh
base=$(cat /tmp/kamilio-569-575-validation.path)
toolchain=$(cat /tmp/kamilio-toolchain.path)
export PATH="$toolchain/bin:$PATH" TMPDIR="$base/tmp" TSX_DISABLE_CACHE=1
unset NO_COLOR
node --import /home/kjopek/project/poe-code/node_modules/tsx/dist/loader.mjs \
  --test-reporter=/home/kjopek/project/poe-code/packages/safe-bash/scripts/test-reporting.mjs \
  /tmp/kamilio-664-retention-20260908-01.test.ts
```

Pre-fix source bindings inspected for the prepared patch:

| Source | SHA-256 |
| --- | --- |
| cleanup.ts | ce5b73160cbc280229474bb3f694dc4279383b29f9653fd7945dfce0b4aaf7cf |
| runtime.ts | 333f20b1466429f73b192e911b678f3279f4f1a8ff7c3fee58178818d3a1bc1d |
| arrays/state.ts | 0791f9158e43a55501ae6debaadaf73142e96f54ce1700058c03fe2265c27a1b |

Artifact SHA-256 bindings:

- Temporary test: e34174c88dca3a3f55ab0abed36f8546ec6024d39644a9fbedaa7c241a323a2f
- Test patch: 8a53ae3fd0c7a9f8d5cbfc95402bbd3c9448129a150b05ce59b5067c33339f27
- Production patch: d717c7e13dbb95e296cc2b82a1e97e66daea9f57a7bf0fa8063d42ea6e058f21

Final implementation SHA-256 bindings:

| Source/test | SHA-256 |
| --- | --- |
| cleanup.ts | 9cffde2dd6e227fc183d64f52bc22c4ba4d7261f97565f5d5251155ef2651681 |
| runtime.ts | 54ce446a1dd78abdffe6ac0e115a890639d77f882730bc8c6e880738bee0c278 |
| arrays/state.ts | 70f139ee65e0138f1e985788c39c502508e7cce06c7efa477d2aca6502d9348a |
| cleanup-retention.test.ts | 581b51d85e8e028879d3cfb00e5ea46f77bd303d29e6b68c43656c1a62307f3d |

No remaining leaf implementation blocker. Root retains exact test-inventory
registration, build/lint and Git/delivery gates. No more writes until root grants
another writer window; #667 is not started.

Root integration changed the deferred retirement-handle binding to `const` for
the maintained prefer-const rule, without changing assertions or product code.
All 18 dedicated tests passed again; the table records the resulting test hash.

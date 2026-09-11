---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
readiness: draft
---

# #657 full-fix patch handoff

## Source classification follow-up

After root's full-sweep RED baseline (144 Bash failures), six source-only fixes
were applied: bytes/checksums/index.ts, du/format.ts, du/du.ts,
plugins/composition.ts, contracts/command.ts and diagnostics.ts (all under
packages/safe-bash/src). Authored checksum/DU/fallback diagnostics are explicit
PublicDiagnostic values; the fixed argv-identity diagnostic has its own TypeError
subclass, preserving TypeError compatibility without trusting arbitrary TypeErrors.
Exact before/after hashes: `/tmp/issue657-classification-followup.inventory.json`.
Focused GREEN: **366/366**, no skips, approximately 3.2 seconds;
`/tmp/issue657-classification-focused.log`. Session 22044 exited. No test files
were changed in this follow-up; no full build/test/lint was run. Raw native rm/rmdir
fixture failures, replaced CD middleware errors, and unknown tree backend errors
remain opaque; their assertion migrations belong to root's other agents.

September 8, 2026. Canonical 49-path grant applied after rechecking all before
hashes; initial after-hashes also verified. Root owns Git, build, lint, full
gates and release. Host access is included. The subsequent authorized grep
catch fix and seven controls are canonical; no historical seals were changed.
Root subsequently granted compression/files.ts, diagnostic-display.test.ts and
safejs/lifecycle.test.ts: all three are now updated (52 product/test/docs targets
plus this plan). Final focused checks are GREEN; tools are frozen for root gates.

## Patch

- Applied initial payload: `/tmp/issue657-full-fix.apply.patch` (do not reapply).
- Unified review patch: `/tmp/issue657-full-fix.patch`.
- Exact path/hash manifest: `/tmp/issue657-inventory.json`.
- Candidate tree: `/tmp/issue657-work/candidate`; unchanged input snapshots:
  `/tmp/issue657-work/base` (materialization adds one trailing newline; manifest
  hashes and patches normalize it back to the actual original bytes).
- 49 exact targets, including source, contract documentation, one new
  typed test and its exact maintained discovery assertion. No shared safe-fs,
  structured #655, pattern algorithms, held copies or README edits.
- All 49 initial after-hashes matched after application. The authorized later
  edits to matching.ts and opaque-errors.test.ts intentionally supersede their
  candidate after-hashes. Runtime changes use narrow hunks, not replacement snapshots.

## Host hook and diagnostic policy

- `InternalErrorHandler = (error: unknown) => void | Promise<void>`;
  optional `onInternalError` on ShellOptions, ShellExecOptions and CommandContext.
  Per-exec setting overrides the shell default; nested runtimes share that exec's
  callback through the existing Budget. No result collection or new observer framework.
- Unexpected failures are reported synchronously at conversion to diagnostics,
  before safe output, with the original value including null/undefined/false/zero/
  empty string. Intermediate codec/worker wrappers retain the original in a
  private cause until conversion; no retained shell collection or deduplication set.
  Repeated conversions are separate events, even for the same error object.
- Callback throws and promise rejections are consumed, not recursively reported,
  printed or converted to statuses. Returned promises are observed but never
  awaited or enrolled in cleanup; host owns asynchronous logging delivery.
  A pending callback does not block exec/dispose. Synchronous host JS is not preempted.
- Caller cancellation, Flow/EPIPE, limits and cleanup keep their existing ordering
  and direct rejection identity, not spurious observer events. Callback-triggered
  caller cancellation follows normal subsequent checkpoints; tested with reason 0.
  Otherwise-swallowed diagnostic sink failures are observable without status change.
- Actual FsError public messages remain public and causes remain private/unchanged;
  they are not traversed or reported as new unknown errors. Other authored typed
  diagnostics stay public. Unknown errors project to `internal error`, without
  stringification or reading their messages/stacks. Public codec diagnostics are
  narrowly recognized before classification; source failures cannot acquire that permission.
- Projection precedes early family formatting, nested patch wrappers, runtime
  diagnostics, regex worker wrapping and SafeJS host-hook failure formatting.
  Explicit SafeJS guest-error results keep their guest contract, not host-fault status.
  This is accidental-disclosure defense, not isolation from hostile host JavaScript.

## Evidence

### Final maintained delivery gate, September 8

Frozen candidate `d25afdaaa` passed every maintained stage in
`/tmp/kamilio-657-verified-gate.W61BGq`: normal `npm run build`,
`npm run typecheck --workspace=virtual-bash`, `npm run lint`, and full `npm test`.
The typecheck includes source/tests and 26 current consumer groups; it is not
runtime acceptance. Exclusive root lint completed with 25 receipts and no
unaccepted errors or warnings. No owned worker or preview ran during lint.

The uncached full test route passed 40,444 shared tests (38 skipped), 282 Bash
runner controls, 22,298 Bash tests (63 skipped, zero failures/cancellations),
288 terminal tests and both native root posttest controls. Workspace membership
and lifecycle dependencies came from the maintained orchestrator; absent unit
tasks and optional skipped profiles are not counted as passes. The earlier
failed full sweep and strict-type run remain retained separately.

The only changes after the successful `9b20027cd` built API/browser checks were
strict test typing and plan records; product sources stayed identical. The
historical HTML live-hash seal is an explicit opt-in tool, not part of the
maintained unit/typecheck route; its original evidence is unchanged and no
unnecessary migration gate was added. Delivery reporting must distinguish the
verified remote-main push from the later scoped and root release results.

- Rebased the two product commits onto upstream `9664c440a` (intrinsic prototype
  tracking), producing `2e011832e` and `9b20027cd`. Normal `npm run build` passed
  on that frozen candidate; built public API smoke and the final browser check
  passed. Viewed screenshot `/tmp/kamilio-657-final-browser.png` shows public DU,
  gzip and checksum diagnostics and continued execution. Browser and preview closed.
- The added maintained SafeBash typecheck exposed 12 strict-typing errors in the
  new opaque-error tests, plus earlier goal-owned #648/#650 test typing defects.
  Source/build behavior was not changed to hide them. The opaque-error test now
  uses actual runtime types and presence/class assertions: scoped strict check
  has zero errors and all 121 runtime cases pass. Original full-typecheck failure
  remains in `/tmp/kamilio-657-final-gate.LSENd8/typecheck.log`; a passing later
  maintained check is still required. The initial gate did not start npm test
  after its typecheck failure.

- Follow-up classification fixes retain authored checksum summaries, DU errors,
  command-not-found fallback and stale-argument identity diagnostics. The latter
  uses a dedicated TypeError subclass rather than trusting arbitrary TypeErrors.
  Focused classification cohort: 366/366 passed. Raw native errors injected by
  the empty-directory fixture remain private; genuine FsError controls stay public.
- Host-error assertion migrations preserve original hook identity and previous
  status/effect/cleanup assertions. Compression/column/archive/table/tail and
  unchanged stream-inspection controls passed 362/362. Tree/sed/empty-directory
  and unchanged agent/DU controls passed 148/148. These cohorts overlap other
  evidence and are not an additive full-suite total. Tree scan instrumentation
  now watches the complete public FsError message, including its errno prefix.
- SafeJS boundary qualification: explicitly returned `{ ok: false, error }`
  remains declared guest data. A rejected injected runtime promise has no trusted
  guest provenance, including when the actual SafeJS run function rejects a
  guest error, so its message becomes opaque and its original value reaches the
  host callback. Retain the prior syntax/budget exit-status mapping from own
  name/code fields without granting those fields permission to expose messages.
  Do not implicitly import an interpreter or infer message safety from class names.
- Shell/contracts host-error migrations passed 74/74 and five further focused
  controls; unchanged byte-carrier rejection controls also passed. The two
  invocation-cleanup-runtime historical manifests still authenticate the original
  lifecycle test (`e61b1d76d32ba85c97de6ed73510adea26a9a6ef40b21d1ebce4ea5eb1be2dca`).
  Their historical bytes are unchanged; no maintained test enforces those old
  records against the changed current test. The active public-consumer binding
  captures current inputs independently. No invented migration gate was added.

- September 8 full maintained gate on local `9d35619a4`:
  `npm run build` passed (71 workspaces, 70 declared builds, root suffix stages).
  Full `npm test` shared stage passed 40,398 tests with 38 skips; SafeBash runner
  passed 282 tests. The complete SafeBash stage failed: 22,131 passed, 144 failed,
  63 skipped, zero cancellations (22,338 total). This is not a passing full gate.
  Original logs remain in `/tmp/kamilio-657-gate.Jdyo0f`; no source inputs changed
  during that run. Follow-up work separates missed authored public diagnostics
  from tests intentionally asserting the old host-detail disclosure. Host-error
  migrations must assert exact opaque output and original hook identity while
  retaining status, cleanup, ordering and byte-effect checks. Public formatting
  controls use actual public errors, not arbitrary host exceptions.
- Built public API smoke passed on that candidate: command continuation, pipeline
  opacity, original TypeError/false identities, per-exec override and public
  FsError cause privacy. Browser screenshot
  `/tmp/kamilio-657-browser-public-diagnostics.png` was captured and viewed:
  native gzip and invalid-regex public messages survive and execution continues.
  This browser check does not inject a host fault. The preview and browser were
  closed; later source corrections require renewed applicable validation.

- Original 57 RED/control witnesses retained; opaque-errors total now **121**.
- Pre-fix baseline: **30 pass / 83 expected RED / exit 1**:
  `/tmp/issue657-full-baseline.log`.
- Candidate with promoted typed test: **113 pass / 0 fail / exit 0**:
  `/tmp/issue657-promoted-candidate.log`.
- Canonical grep pre-fix: **6 RED / 1 genuine SyntaxError control GREEN**:
  `/tmp/issue657-canonical-grep-red.log`. Catch now handles only SyntaxError;
  TypeError/false/null/0/empty/undefined propagate unchanged to the host hook.
- Canonical targeted suite: **120 pass / 0 fail / exit 0**, no skips:
  `/tmp/issue657-canonical-120.log`.
- Narrow adjacent cohort: **149 pass / 4 fail / exit 1**, no skips:
  `/tmp/issue657-canonical-adjacent.log`. Seven files: diagnostic-display,
  regex provider/bounded-provider, compression safety, archive lifecycle,
  SafeJS lifecycle and shell cleanup-retention. Session 62646 exited; no live tests.
- Additional dual-cause compression witness reproduced RED before the source fix:
  `/tmp/issue657-cleanup-red.log` (**0 pass / 1 fail**).
- Final canonical targeted plus the same adjacent cohort: **275 pass / 0 fail**,
  no skips/cancellations, exit 0, approximately 1.6 seconds:
  `/tmp/issue657-canonical-final-focused.log`. This is 121 opaque-error tests plus
  154 adjacent tests, including the new explicit guest-error escaping control.
  Final session 10896 exited; no active process handles.
- Tests use memory FS/sinks, injected SafeJS stubs and memory regex event workers;
  no LLM, native FS adapter, network, real worker, fixture-file write, full suite,
  Git, build or lint. Compiler transforms in the loader are memory-only test loading,
  not a package build/typecheck. Root type/build/lint gates remain outstanding.
- Coverage adds host identity across command/middleware/family/wrapper boundaries,
  per-exec override/nested dispatch, callback throw/rejection/nonsettlement,
  callback cancellation, public FsError causes, native errno, codec falsey sources,
  native codec controls, regex/expr host faults and existing guest diagnostics.
- Two old assertions were unreachable behind their initial disclosure RED: borrowed
  sinks also populate ShellResult, and absolute tar operands print a safe leading-slash
  notice. Those expected values now preserve observed current behavior.
- No broad validation is claimed. All original targeted assertions remain.

## Resolved blockers and freeze

- The authored compression cleanup message is wrapped in PublicDiagnostic with
  the original AggregateError as private cause. Both original failure objects
  reach the host hook unchanged. Existing cleanup/status assertions pass unchanged.
- The two injected SafeJS host-failure tests now assert exact opaque text and
  original host-hook identity, retaining raw guest stderr and pending-output drain.
  An additional actual `{ ok: false, error }` guest-result control asserts exact
  escaping, unchanged guest status and zero host-hook events. Existing helper's
  CommandContext overrides support the callback; no helper changes were needed.
- No remaining focused-test blockers. Tools frozen for root coordination; no
  active processes and no Git/build/lint/full-suite commands run here.

## Canonical focused command

```sh
env -u NO_COLOR TSX_DISABLE_CACHE=1 node packages/safe-bash/scripts/test-reporting.mjs \
  --import /home/kjopek/project/poe-code/node_modules/tsx/dist/loader.mjs \
  --experimental-test-isolation=none --test-concurrency=1 \
  packages/safe-bash/tests/shell/opaque-errors.test.ts
```

Canonical application is complete within the grant; commit, push, release and
issue closure have not occurred here. Root owns remaining gates and delivery.

## Exact granted write inventory

The following 49 original targets plus these three subsequently granted paths:

- modify `packages/safe-bash/src/commands/bytes/compression/files.ts`
- modify `packages/safe-bash/tests/commands/diagnostic-display.test.ts`
- modify `packages/safe-bash/tests/commands/safejs/lifecycle.test.ts`

- modify `packages/safe-bash/scripts/integration-inputs.test.mjs`
- modify `packages/safe-bash/src/commands/archive/index.ts`
- modify `packages/safe-bash/src/commands/archive/internal.ts`
- modify `packages/safe-bash/src/commands/archive/stream.ts`
- add `packages/safe-bash/src/commands/bytes/compression/errors.ts`
- modify `packages/safe-bash/src/commands/bytes/compression/gunzip.ts`
- modify `packages/safe-bash/src/commands/bytes/compression/index.ts`
- modify `packages/safe-bash/src/commands/bytes/compression/stream.ts`
- modify `packages/safe-bash/src/commands/bytes/encoding/base.ts`
- modify `packages/safe-bash/src/commands/bytes/encoding/shared.ts`
- modify `packages/safe-bash/src/commands/bytes/encoding/xxd.ts`
- modify `packages/safe-bash/src/commands/column/internal.ts`
- modify `packages/safe-bash/src/commands/diff-patch/patch-gnu-paths.ts`
- modify `packages/safe-bash/src/commands/diff-patch/patch.ts`
- modify `packages/safe-bash/src/commands/diff-patch/shared.ts`
- modify `packages/safe-bash/src/commands/du/budget.ts`
- modify `packages/safe-bash/src/commands/expr/command.ts`
- modify `packages/safe-bash/src/commands/find.ts`
- modify `packages/safe-bash/src/commands/html-to-markdown/index.ts`
- modify `packages/safe-bash/src/commands/index.ts`
- modify `packages/safe-bash/src/commands/internal.ts`
- modify `packages/safe-bash/src/commands/move.ts`
- modify `packages/safe-bash/src/commands/regex-execution/bounded-provider.ts`
- modify `packages/safe-bash/src/commands/regex-execution/matching.ts`
- modify `packages/safe-bash/src/commands/regex-execution/portable.ts`
- modify `packages/safe-bash/src/commands/regex-execution/protocol.ts`
- modify `packages/safe-bash/src/commands/regex-execution/worker.ts`
- modify `packages/safe-bash/src/commands/safejs/index.ts`
- modify `packages/safe-bash/src/commands/search/options.ts`
- modify `packages/safe-bash/src/commands/search/shared.ts`
- modify `packages/safe-bash/src/commands/split/names.ts`
- modify `packages/safe-bash/src/commands/split/options.ts`
- modify `packages/safe-bash/src/commands/split/split.ts`
- modify `packages/safe-bash/src/commands/standard.ts`
- modify `packages/safe-bash/src/commands/stream-format/rev.ts`
- modify `packages/safe-bash/src/commands/table-text/internal.ts`
- modify `packages/safe-bash/src/commands/tail-follow.ts`
- modify `packages/safe-bash/src/commands/text-programs/shared.ts`
- modify `packages/safe-bash/src/commands/text.ts`
- modify `packages/safe-bash/src/commands/tree/io.ts`
- modify `packages/safe-bash/src/contracts/command.md`
- modify `packages/safe-bash/src/contracts/command.ts`
- add `packages/safe-bash/src/diagnostics.ts`
- modify `packages/safe-bash/src/shell/arithmetic.ts`
- modify `packages/safe-bash/src/shell/input.ts`
- modify `packages/safe-bash/src/shell/runtime.ts`
- modify `packages/safe-bash/src/shell/shell.ts`
- modify `packages/safe-bash/src/shell/types.ts`
- add `packages/safe-bash/tests/shell/opaque-errors.test.ts`

The already-written repository plan is
`docs/plans/bugfix-657-opaque-errors.md`; it is not duplicated inside the source patch.

## SafeJS status-only follow-up and live harness migration (2026-09-08)

The privacy decision intentionally makes raw runtime rejections opaque, including
actual interpreter syntax, budget and guest-throw rejections. Without trusted
provenance those rejections cannot distinguish a guest failure from a host bug.
Their original identities reach `onInternalError`; the public text is
`internal error`. Explicit returned `{ ok: false, error }` guest results remain
public. No runtime classifier seam, import, new option or structural-message
allowance was added, and the interpreter package was not modified.

The SafeJS adapter restores only its prior own-data `name`/`code` status mapping:
`budgetExceeded` takes precedence at 124, `ParseError` maps to 2, and other
rejections map to 1. This is status compatibility, not proof of guest provenance.
A spoofed host object with both fields consequently retains 124 without exposing
its message. Rejection status extraction does not read `message`; throwing
message-getter controls observe zero accesses. Existing limit and usage handling,
output draining, cleanup and cancellation paths remain unchanged.

The fresh maintained Node 22/tsx RED run had 25 tests: 18 passed and 7 failed on
status assertions. After the status-only patch, the six owned harness files pass
193/193, and adjacent SafeJS command/lifecycle tests pass 40/40, with no skips or
cancellations. Actual runtime syntax, bounded 30-step exhaustion and guest throws
check original hook identity; an explicit returned guest-error control checks
public output and no hook event. The grep worker counters are 24 created,
24 exited, zero active. Logs are `/tmp/kamilio-657-status-red.log`,
`/tmp/kamilio-657-status-green.log`, and `/tmp/kamilio-657-status-adjacent.log`.
These are focused checks, not a full build, lint or full-suite claim.

Exact follow-up source and live test inventory:

- `packages/safe-bash/src/commands/safejs/index.ts`
- `packages/safe-bash/tests/commands/node-safejs.test.ts`
- `packages/safe-bash/tests/commands/safejs-stress/lifecycle.test.ts`
- `packages/safe-bash/tests/commands/html-to-markdown/io.test.ts`
- `packages/safe-bash/tests/commands/html-to-markdown/inline-normalization-fix/bounds.test.ts`
- `packages/safe-bash/tests/commands/grep-aliases/safety.test.ts`
- `packages/safe-bash/tests/commands/xargs-parallel.test.ts`

Live harness migrations retain original statuses, accepted byte prefixes, cleanup
and settlement ordering, while asserting exact opaque text and original hook
identity for injected host failures, including falsey rejection reasons. Historical
receipts, manifests, capture data and seals are unchanged. The historical HTML
inline-normalization `seal.mjs` compares the old receipt's `io.test.ts` hash with
the live file: rerunning that author capture against this migrated harness needs
an explicit root-owned versioned migration, not a rewrite of historical receipts
to pretend unchanged source bytes. Root owns inventory, Git and integration gates.

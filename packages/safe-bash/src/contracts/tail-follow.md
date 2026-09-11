# Bounded virtual tail follow

## Public configuration

The actual `tail` member of `streamCommands` supports ordered `-f` and `-F`,
including combined short flags. The last follow flag wins. Count values and
operands after `--` are not follow flags. Finite `head`/`tail`, their bounded
prefix/suffix processing, and the existing `tee` member remain unchanged.

`streamCommands(maxTeeTargets = 64, maxTailFollowHandles = 64)` adds a second
argument without changing the first. Standard, browser and agent command
factories/plugins expose `maxTailFollowHandles?: number`. Its value must be a
nonnegative safe integer. Zero disables named follow, not finite commands or
stdin follow. The limit is per tail invocation, not a global filesystem quota.
No scheduler or host execution option is public.

Before filesystem effects, named operands reserve independent slots, including
duplicate names. `-F` also reserves one comparison slot. Thus the default admits
64 named `-f` operands or 63 named `-F` operands. This preflight also applies to
initial-only execution. Shell redirections performed before command admission
are outside that preflight.

`--max-idle SECONDS` and `--max-idle=SECONDS` require a follow mode. Nonnegative
decimal seconds must resolve exactly to safe integer milliseconds. Exponents,
signs, nonnumeric values, missing values, overflow, and nonzero sub-millisecond
fractions are rejected before filesystem access. Zero performs initial
selection without follow/retry waiting. Omission adds no timeout; existing
Shell CPU, wall-clock and output limits still apply.

## Retained-resource protocol

Named follow requires both an effective `retainedRead: true` capability and
`openReadFile`. Per-path capabilities take precedence when supplied. There is
no pathname-read fallback, host subprocess, watcher, ambient filesystem access,
or emulation for unsupported adapters. Stock adapter refusal for overridden
methods remains enforced. Filesystem wrapper qualification is separate from
the command's genuine-Memory/composition controls.

Initial named selection is bounded by the first retained `stat().size`.
Ordinary counts apply only to that initial selection. Zero counts still follow
future appended bytes. An unmet initial `-n +N` skip ends at initial EOF; it does
not suppress later appended lines. The selected GNU 8.30 `-c +N` behavior keeps
the logical starting offset even beyond EOF: a subsequent size check may report
truncation and replay existing bytes without an actual truncate having occurred.

`-f` pins the retained resource across rename/unlink. A size below the
acknowledged position resets the position to zero. Same-size overwrites do not
constitute appends. A truncate/regrow occurring entirely between observations
cannot be detected by this stat/read contract.

`-F` opens one candidate at a time and compares complete retained identities:
the same identity-scope object/symbol and nonnegative safe integer device/inode
values, including zero. Unknown identity is unsupported; pathname, size and
timestamps are not identity substitutes. Same-identity candidates close before
another candidate is admitted. Replacements release the old reader and start
at zero. Reported name unavailability stops old-resource reads. Recovery starts
at zero even when the same resource reappears; delayed initial opens do not
repeat suffix selection.

Retryable failures are ENOENT, ENOTDIR, EACCES, EPERM and EISDIR. An initial
operand failure retains status 1 after recovery. A later retryable `-F` name,
access or type loss does not itself fail controlled completion, even if still
unavailable at idle expiry. Other operational failures retain the established
command diagnostic/status mapping. Diagnostic/output failures, cancellation
and fatal Shell limits are not name-retry events.

Headers follow quiet/verbose and operand-switch selection, including initially
empty successful files, initial directory errors, and the selected late EACCES
empty-header transition. Initial EISDIR with positive line selection stops
before later operands; this is not generalized to other count modes. Diagnostics
use the existing internal `diagnostic()` boundary, not custom raw stderr writes.
Filesystem diagnostic wording is not claimed to match native tail byte-for-byte.

## Scheduling, input and ownership

Follow polls at 100 ms granularity, with reads of at most 64 KiB. Each round
captures finite sizes and rotates one chunk per active reader, without sleeping
between backlog chunks. Cooperative yields receive the original command signal,
not the private output-operation signal. No new Shell or private CPU allowance
is created.

Output and diagnostics are awaited. Retained positions advance only after
accepted output; borrowed input retained by suffix selection is copied by the
existing bounded helper. The existing suffix buffer ceiling remains 32 MiB.
Idle begins after initial work is acknowledged and resets after appended bytes
are acknowledged. Empty reads, metadata changes and retry diagnostics do not
reset it. Blocked output is not idle time. At the exact idle boundary, admission
stops before another poll; an append not yet observed is not promised delivery.

Consumed stdin ends at actual EOF independently of named readers. Implicit
default stdin does not terminate named follow. `-F -` is refused. Positive stdin
selection streams before EOF. Explicit idle also applies while awaiting stdin;
the bounded suffix is preserved and iterator return is joined. With zero idle,
immediately settled reads can contribute initial bytes, but a pending read is
stopped at the initial timer checkpoint rather than waiting indefinitely.

One output/session owner is registered before I/O or timers. Reusable sets track
current/candidate readers, in-flight operations and active waits; there are no
per-poll permanent cleanup callbacks or repeated races against one pending
promise. Closing slots remain occupied until release settles. A failed close
stops admission and its slot is never reused. Late acquisitions are observed
and closed before drain completes. Timers/listeners and stdin return belong to
the same drain.

Primary failure presence is represented separately from its value, preserving
undefined, null, false, zero and empty-string failures through secondary cleanup.
Caller cancellation wins after drain. Ordinary errors still use the established
public command mapping; Shell-owned cleanup-only failures remain exact. Owned
pipe-consumer closure stops follow and closes its readers without retrying.
An uncooperative provider that never settles an admitted operation/release can
hold drain: bounded ownership is not forcible termination of arbitrary code.

## Validation provenance and integration boundary

Implementation follows root-owned `docs/plans/bugfix-639-command-profile.md`,
not superseded draft sections of the original plan. On September 6, 2026 the
referenced native reports contain 28 observations, 27 completed protocols and
one honest natural early-exit protocol; the earlier eight observations remain
preserved. Native execution was not added to product code or these tests.

Native report provenance under the existing validation base:

- `tail639-sidecar-20260906.l0k38zq4/report.json`:
  `961da1afebf2eaa2dd66679fa6bf342a508dc2961cf9d79354158e7436cce063`
- `tail639-boundary-20260906.dcn1_by3/report.json`:
  `d7d2827c8ad741cca782c1746a7e67522c5bbc1994940dd78918f74fd796bf3f`

Focused tests use Node 22.22.0, tsx, normal `node:test` child isolation and
`--test-concurrency=1`, from the existing validation base with its TMPDIR and
`TSX_DISABLE_CACHE=1`. No host files, slow sleeps, source/build copies, shared
builds, broad guards, Git mutation, or registry edits were performed by this
command owner. An approval-review timeout preceded the expanded-test run; it
was retried without changing the isolation mode.

Recorded development results, without discarding failed attempts:

- Fresh unsupported-feature RED: 21 tests, 7 pass / 14 fail; then 21/21 GREEN.
- Expanded command controls: 54 tests, 47 pass / 7 fail. Five failures exposed
  stdin-primary masking by cleanup; two recovery fixtures incorrectly placed
  recovery at the idle deadline. The mask was fixed and fixture timing corrected.
- Initial expanded Shell run: 73 tests, 54 pass / 19 cancelled when a CPU control
  awaited termination without a bounded checkpoint. The control was corrected
  to report the actual invariant instead of leaving its promise pending.
- Actual Shell lifecycle controls then reported 21 tests, 19 pass / 2 fail:
  shared CPU enforcement and pending stdin-return drain, detailed below.
- Additional candidate-cleanup controls: 64 command tests, 59 pass / 5 fail;
  falsey retained-stat failures were masked by candidate close failure. The
  private helper now retains the primary, and all 64 command tests pass.
- Final focused command plus unchanged `streams.test.ts` and
  `tee-target-admission.test.ts`: 204/204 pass, zero skipped/cancelled,
  1699.297146 ms. This covers the new cap without weakening the tee controls.

The actual Shell suite covers shared CPU, wall-clock cancellation with held
cleanup, independent stdin EOF, initial/output backpressure and byte ownership,
pipe-consumer closure, falsey close-only/caller failures, late opens, shared
output-budget failure, explicit stdin idle, and ordinary VFS error mapping.

Two concrete cross-scope integration blockers were reported to root rather
than bypassed in the command or weakening tests:

1. Runtime registers yield checkpoints for its combined runtime signal, while
   the command receives a distinct cancellation-delivery signal. The command
   correctly yields that original context signal, yet the 5 ms shared-CPU test
   reaches 12 ms and three reads instead of stopping after one.
2. ShellInput exposes an iterator without return; its InputCursor cleanup does
   not await underlying return when a read is pending. Explicit stdin idle
   therefore lets Shell settle before a held underlying return completes,
   despite the direct command's supplied-iterator drain controls passing.

These failures were retained without weakening their controls. Root subsequently
authorized the narrow core repairs recorded below. Root still owns the combined
wrapper rebuild, final qualification and delivery. Focused results do not establish
issue closure or release qualification.

## Authorized core repairs and final focused handoff

After the initial command freeze, root expanded ownership to `src/shell/input.ts`,
the Runtime constructor checkpoint registration, and focused input regressions.
Runtime editing waited for root's explicit ownership-transfer acknowledgement;
the separate diagnostic patch remained outside this repair. The original tail
helper and both tail test files stayed unchanged.

InputCursor normal close now awaits its single shared return promise even when
an input read is pending. The wait still uses the original cleanup signal and
the existing `interruptible()` boundary. It does not await pending `next()`.
Caller cancellation and disposal therefore still stop waiting for opaque input
work, and late next/return rejections remain observed. EOF avoids unnecessary
return; primary read failures are not replaced by cleanup errors; sequential
borrowers still share the cursor until final owning close. This is not a new
invocation-registered, uninterruptible cleanup obligation for arbitrary host stdin.

The Runtime constructor registers one budget-only checkpoint callback on both
the runtime signal and the original command signal. Both use the same existing
CPU deadline. Capturing the Budget rather than a child Runtime avoids retaining
a completed child Runtime through the longer-lived command signal. No command
signal replacement, private allowance, or new runtime instance is introduced.

Fresh core evidence on September 6, 2026, with normal isolated test children:

- New `tests/shell/input-pending-return.test.ts` adds 14 deterministic controls
  for pending-input normal return, exact falsey/NaN cleanup failures, caller
  cancellation, late rejected input work and opaque-generator disposal.
- Before the input repair, the new tests plus unchanged input-return cleanup
  and stdin-origin suites reported 119/132 pass, 13 fail. Six early-settlement
  rejection assertions also produced asynchronous-handler warnings; assertion
  promises now receive immediate observers without changing their expectations.
- After the input repair, those 132 tests all pass. Adding the unchanged tail
  lifecycle suite produced 152/153 pass, with only the original CPU RED remaining.
  The explicit stdin-idle held-return control passed without modification.
- After the constructor-only repair, tail lifecycle, existing parallel-xargs
  lifecycle and security/budget controls report 76/76 pass, zero skipped or
  cancelled, 1111.982081 ms. Both original Shell RED controls now pass unchanged.
- The earlier 204/204 command/finite-stream/tee result remains evidence for the
  unchanged command files; it was not needlessly rerun during the core repair.

Root must register the new input regression path and perform the combined build
and qualification. All command-owner files are frozen at this handoff; no Git
mutation, shared build, full guard, README edit or filesystem-wrapper edit was
performed by this owner.

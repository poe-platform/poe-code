# Narrow F2 followup; F1 blocked

## Freeze and scope

Source fix: `c467e8a7bdd78048985f97539bc76e38ff786b09`.
Frozen regression and original failures: `beaeeeaaaadc57729ccdb6ff9f51c1e38c393c9f`.
Prior source/evidence remain `b1939d76b8e28687320a7253380a00b446424548` /
`35249954c1994940a8a89bad295ab34e4285bbee`. Independent original finding
commit `a818f24b7cbac9b5f86c224b88af7bb429e18089` remains authoritative evidence,
not replaced by this author's checks. `prior-author-ready.txt` preserves the
previous marker verbatim before replacement.

Only three production code lines changed in `client.ts`: the receive-side
`messageerror` handler, registration, and matching removal. A narrow adjacent
README correction distinguishes internal cleanup from public Shell settlement.
No runtime, filesystem, registry, exports, package configuration, lifecycle,
glob/walk, original tests/reports or production-review files were edited.
No subagents. No pathological probes: followup zero; prior author 0/2 and
independent 0/4 remain separate, all six unchanged; historical twelve untouched.
No new pool, feature, timing matrix, baseline benchmark or acceptance claim.

## F2: receive failure is terminal protocol failure

`src/commands/regex-execution/client.ts:34`, `:47` and `:80` route the event
through existing `Slot.fail` / `exchange` / `retire` handling. Startup and active
requests reject as `PROTOCOL`, not after their 40ms timeout. Idle slots retire
without waiting for idle expiry; there is no past request to reject in that
state. Existing termination promise identity, capacity release, timer clearing,
signal-listener removal and first-recorded-error behavior remain unchanged.
No listeners are removed merely to hide a still-running worker.

The unchanged nine-test regression failed 5/9 before the fix (4 pass): startup
became STARTUP_TIMEOUT, active/native became REQUEST_TIMEOUT, idle retirement
did not start, and protocol precedence was lost. Raw outputs and source hashes
are `before-messageerror.*`; those failures are retained. After fix, 9/9 pass
in `after-messageerror.*` and again within `frozen-cohort.*`.

Controlled tests hold termination behind an explicit gate, check retirement
starts by the next event-loop turn while settlement remains pending, duplicate
messageerror, idle queue capacity and awaited session close, then assert exactly
one termination and zero message/messageerror/error/exit and abort listeners.
Precedence cases retain abort identity, prior timeout, prior fatal worker error,
prior disposal, and a recorded protocol failure despite a cleanup-time abort.
One real compiled Worker receives a deliberately emitted receiver event and
uses native terminate/exit semantics. This is event injection, not a claim to
have induced a naturally occurring Node structured-clone deserialization fault.

The independent fake Worker uses EventEmitter and asynchronously emits exit
from terminate, matching the aspects under test; its original transport harness
was read, never edited or rerun by this author. Node v22.22.2 primary documentation
was inspected on August 27, 2026: Worker messageerror is a receive-side Error event,
terminate is asynchronous and fulfills at exit, and exit is the final Worker
event. Primary source: `https://raw.githubusercontent.com/nodejs/node/v22.22.2/doc/api/worker_threads.md`.
No assumptions about browser MessageEvent.data or synchronous termination.

## F1: exact root cause and required contract

Implementation STOPPED. This is an absent public awaited-cleanup barrier, not
an indefinite worker leak or a failure to call/await terminate inside the client.

- `src/commands/grep.ts:86` awaits `session.close()` in its handler finally;
  `src/commands/search/rg.ts:164` does likewise. Client `:222` waits pending
  requests and executor close; `:72` retirement awaits Worker termination.
- `src/shell/runtime.ts:100` implements `interruptible` as a signal/operation
  Promise.race (`:110`), observing late rejection but not awaiting the losing
  operation. Registry execution is wrapped at `:870` despite awaiting the
  actual definition internally at `:858`.
- Pipeline `:345` separately races isolated command execution. Downstream EPIPE
  aborts at `:338`; early-close scheduling aborts upstream at `:361`. The raced
  task can finish, including its pipe/input cleanup, before command finally.
  Pipeline `:371` awaits these raced tasks, not the underlying handler cleanup.
- `src/shell/shell.ts:107` also races runtime execution. Its own finally `:128`
  closes stdin only. `:138` dispose awaits setup and plugin dispose callbacks,
  not outstanding handler-finally/resource work.
- `src/contracts/command.ts:20` has signal and invoke but no invocation cleanup
  registration/barrier; definition `:44` provides execute only. Existing
  `src/contracts/plugin.ts:16` does provide optional plugin-wide dispose, so it
  would be inaccurate to say no disposal API exists at all. `src/plugins/index.ts:53`
  and `src/commands/index.ts:31` install definitions without exposing executor
  disposal. Even wiring plugin disposal would not make earlier exec settlement
  await cleanup, and that wiring is outside this assignment.
- `src/contracts/plugin.ts:23` middleware awaits downstream completion, but
  runtime still races the resulting promise. A wrapper cannot restore the
  missing public barrier without changing the lifecycle contract.

Minimum required approved behavior: invocation-owned cooperative resource cleanup
must be represented separately from interruptible/uncooperative command or host
work, propagated through dispatch and pipeline cancellation, and drained before
the relevant public exec settlement and Shell disposal finish. Define exact
ownership, once-only registration/drain, error and cancellation precedence, and
disposal interaction before implementation. Do not simply await all potentially
uncooperative handler/IO promises indefinitely. This requires a root-approved
command/runtime/Shell lifecycle contract and corresponding owners; no new API
signature, wrapper, synchronous blocking, unref trick, early listener removal,
or disabling early close is proposed or implemented here.

The actual moved product reproduces the ORIGINAL tiny public command unchanged:
`Shell({fs: new MemoryFileSystem()}).use(agentCommands())`, then
`grep -E '^a' | head -n 1` on `ab\n`.repeat(200), exactly 600 input bytes.
Status 0, stdout `ab\n`, stderr empty. One Worker is live both at exec settlement
and after await shell.dispose(); termination was called once but not finished.
Both original zero-active assertions are retained as failures, not inverted
into acceptance. Recorded listeners are message1/messageerror1/error1/exit3
(exit includes the observer and native termination machinery). After separately
awaiting that exact already-started termination, all four package-child Workers
have threadId -1, one termination each, zero listeners. No artificial termination
delay, safety termination, process kill or retry was needed.

## Validation and evidence

- `frozen-build.*`: existing `npm run build` passes and emits the actual static
  worker used by source tests and the package; no custom worker compilation.
- `frozen-types.*`, `author-types.*`: both scoped TypeScript checks pass.
- `frozen-cohort.*`: **65/65**, the original 56 author tests plus nine unchanged
  followup tests; no failures/skips/TODO. This is not the original 730-test gate.
- `global-types.*`: this observation of `npm run typecheck` passes. Prior unrelated
  diagnostics in `../types-second.log` and `../build-initial.log` remain byte-for-byte
  unchanged. No foreign typing fix; shared HEAD moved during this assignment.
- `package-evidence.json`: one offline npm tarball extracted then moved, zero
  runtime dependencies, eight JS/declaration asset hashes matching the build,
  bare Node22 ESM public grep/rg controls and packed injected F2 pass; public
  declaration consumer passes. Packed F1 child deliberately exits **1** for its
  two retained cleanup failures; package assembly/check runner exits 0 while
  recording `publicCleanupAccepted: false`. Do not present child exit as passing.
- Four Workers total in that package child, all eventually retired exactly once
  with zero listeners; only the first three have awaited cleanup at their case
  settlement. Original author executor instrumentation separately reports 17
  Workers with zero active before its safety cleanup. No aggregate worker count
  is claimed for uninstrumented tests.

Client SHA-256: `79031a09a0d4259494d130aa47abcccebcd4230d7c83cc9feab07303ddf3a139`.
Product archive SHA-256: `fbae0541c9bee1e58a78aa1e1a7329b60392f834feb124efad155a89d26c993f`.
Each check claims new evidence paths exclusively and records command, status,
stdout/stderr identities, all tracked source hashes and dirty/shared HEAD state.
No tracked source changed during any individual captured check; unrelated owners
changed files/HEAD between checks. The owned source hash is frozen, not a claim
that the entire shared tree stopped moving. Artifacts remain under ignored
`artifacts/product`; no historical artifact was overwritten or deleted.

Different independent verification must rerun its ORIGINAL frozen checks after
the new marker, preserving F1 until approved lifecycle work exists. Glob/walk
host-regex scope remains separately blocked. No default/production acceptance,
full-project gate, universal parity, superiority or 72-hour completion claim.

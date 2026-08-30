# Shared external stdin: independent contract diagnosis

## Root handoff

**One real error-propagation defect; the additional universal external-input
settlement barrier is not promised by the existing contract.** Product source is
read-only. Route the narrow error-path fix to the shared shell input owner, not
the alias/column authors. No new API is needed for that fix.

- **Alias ROOT-BLOCKER: reproduced.** Ordinary `grep`, `egrep`, and `fgrep` each
  silently return status 0 with empty stdout/stderr after the external iterator's
  `return()` throws synchronously or rejects asynchronously. Return is called
  once. These are six failed behavior rows, not six separate product bugs.
  Three additional unread-input `true` rows lose `undefined`, `null`, and Error
  return rejections. All nine remain rejected behavior, not manufactured passes.
- **Column ROOT-BLOCKER: observation reproduced, stronger requirement not
  established.** Without disposal/abort, actual `column -t` remains pending on
  the external return gate. Calling `dispose()` then aborts the execution budget:
  exec rejects with `Shell is disposed` and dispose settles while the opaque
  return is still pending. The original reproduction measures only after that
  disposal, not before. Its unchanged script still exits **1 / HOLD**; neither
  its capture nor its assertion was edited.
- **Registered ownership is different and works in this scope.** Column-owned
  VFS cleanup keeps both exec and concurrent dispose pending until its registered
  return gate retires. A custom registered owner behaves the same during caller
  abort while its separate raw external `next()`/`return()` remain opaque.
  Registered cleanup failures are surfaced even after a nonzero command result.

Final frozen source is `eaed12f88365e69597994c4f2e6324a020202b66`, not moving HEAD.
Live Dirac column edits were excluded. Harness commit: `8aa4db42`.
The 34 observations were reproduced twice: **25 compatible/control rows and nine
retained defective rows**. This is not 34 passing behavior acceptances. The
unchanged five-file contract/lifecycle scope is **63/63**, zero skip/cancel/TODO.
No broad gate, native-parity claim, product fix, private access, or integration
approval is made here.

## Contract boundary, not a new inferred contract

All source line references in this report refer to the frozen revision.

1. `src/contracts/io.ts:4` defines `ByteSource` only as
   `AsyncIterable<Uint8Array>`. It declares no owned-input drain/cancellation API.
   `src/contracts/command.md:40` limits `registerCleanup` to **cooperative,
   invocation-owned** cleanup; direct/custom contexts may omit it.
2. `src/contracts/command.md:64` excludes arbitrary host promises/input reads from
   acquisitions the runtime must await. `src/contracts/command.md:83` requires
   public exec/dispose to drain accepted callbacks, explicitly **not** opaque
   handler/middleware/FS/sink/input promises. That does not authorize ignoring a
   failure from cleanup the runtime actually selected and awaited.
3. `src/contracts/command.md:99` gives registered-drain outcome precedence:
   exact caller reason, then selected execution rejection, then cleanup failure,
   then command result. It does not turn every external iterable into a registered
   owner. Nor does lack of registration mean that all errors must be discarded.
4. The concrete contract helper `readBytes`, `src/contracts/io.ts:200`, propagates
   early-return failure on the ordinary non-aborted path, preserves a primary
   read failure, and observes rather than awaits cleanup after abort. This review
   executes these distinctions, including rejection values `undefined` and `null`.
5. `tests/shell/invocation-cleanup-pipeline.test.ts:73` explicitly requires that
   opaque pending input and return **not delay** owned cleanup/caller cancellation.
   `tests/shell/lifecycle-probe.ts:9` preserves cancellation during pending external
   cleanup and observation of late cleanup rejection. These unchanged tests pass.
6. `tests/shell/lifecycle.test.ts:71` protects borrowed cursor/queued cancellation
   semantics. `docs/OUTPUT_LIFECYCLE_REVIEW.md:8` is a **design review, not a new
   implemented API**; it also explicitly cautions against treating every stdin
   read as owned and states that `stdinIsDefault` is origin, not close authority.

Thus the raw-error finding is an existing input-close/error-propagation defect,
not evidence that accepted `registerCleanup` callbacks were skipped. The docs
do not separately spell out every raw iterator-return outcome; the proposed
repair follows the already awaited owning-close path and contract helper error
handling, without importing the stronger registered-drain barrier into it.

## Actual call paths

### External return rejection

`Shell.exec` creates the invocation scope/budget. `Shell.#execute` wraps the
external source in owning `ShellInput` (`src/shell/shell.ts:132`). Commands receive
borrowed views: `src/shell/input.ts:79` shares the cursor and
`src/shell/input.ts:90` intentionally exposes `next()` but no `return()`.
An early grep stop therefore cannot close another command's shared input.

After command settlement, the **outer owner** reaches
`src/shell/shell.ts:174` and awaits `stdin.close()`; it already propagates a close
error when no execution rejection was selected. `ShellInput.close`,
`src/shell/input.ts:233`, calls `InputCursor.close` only for the owner.
The defect is `src/shell/input.ts:65`: the real external return promise is followed
by `.then(() => undefined, () => undefined)`. Every rejection is converted to
fulfillment before the non-pending-read path awaits it at line 66.

The same hash/location was identified by the original alias report; this is not
an alias-specific forwarding bug. Direct grep/alias execution against the same
structural source exposes failure. No alleged worker leak is needed to reproduce
the loss. `ByteReader` is not an actual runtime class here: the relevant classes
are `InputCursor`, `ShellInput`, and command-local record readers.

### Deferred return and disposal

On ordinary completion with no outstanding `next`, `InputCursor.close:66` awaits
the external return through `interruptible` (`src/shell/runtime.ts:102`). The
column reproduction therefore waits **before disposal**, despite the local
column input-limit result already being selected.

`Shell.dispose`, `src/shell/shell.ts:186`, closes accepted scopes, aborts each
active execution budget and awaits registered drains/plugin disposal. It does
not promise to wait for each active opaque input promise. That budget abort
interrupts the external return wait. A caller abort likewise wins by its exact
reason, with a later external return rejection observed without unhandled events.

Column's `ColumnInputs` registers its close callback before managed acquisition
(`src/commands/column/internal.ts:94` in the frozen source). Its managed VFS
iterator has a real return authority and its idempotent drain waits for it
(`src/commands/column/internal.ts:115`, `:146`). Its borrowed Shell stdin iterator
has no such return authority. Completing that local registration does not imply
that Shell transferred ownership of the original external iterator to column.

## Concrete cases

| Boundary | Actual observation | Classification |
| --- | --- | --- |
| Normal EOF, direct helper + Shell | Exact multibyte bytes, no return after EOF | Existing behavior |
| Early stop, direct helper + Shell | One owning return; no lost first record | Existing behavior |
| Direct grep/egrep/fgrep, sync/async rejected return | Failure remains visible | Six positive error controls |
| Shell grep/egrep/fgrep, same sources | Return once; status 0, empty output/error | Six retained defect rows |
| Unread external source, `true`, return rejects Error/null/undefined | No reads; one return; silent status 0 | Three retained defect rows |
| Direct `readBytes`, Error/null/undefined return rejection | Original rejection identity preserved | Three positive error controls |
| Primary read failure or output-budget rejection + secondary return failure | Existing primary path remains selected | Preservation controls |
| Registered cleanup fails after status 0 or 7 | Public rejection, same error identity | Owned-cleanup guarantee holds |
| Column external deferred return, no interruption | Exec still pending; after release, original input-limit status 1 | Existing ordinary wait |
| Same external return, then dispose | Exec rejects/dispose settles before release | Stronger barrier not promised |
| Same external return, then caller abort | Exact caller object; public settlement before release | Existing caller precedence |
| Column VFS-owned deferred return + dispose | Both operations pending until gate release | Registered barrier holds |
| Direct column without registration hook | Its own finally waits for return | Not a public cancellation-barrier claim |
| Structural pending next + pending return + registered cleanup | Registered gate delays settlement; after its release exact caller 0 wins while raw inputs remain pending | Explicit ownership distinction |
| Async generator awaiting next input | Return called once but queued behind next; public abort settles before generator finally; finally completes after controlled releases | Cannot infer forced preemption from `.return()` |
| Sequential `one; one; drain` | `ABC`, no intermediate return, one serialized cursor | Borrowed/shared lease preserved |
| Two builtin reads from one multibyte chunk | `α|β`, remainder retained, one final owning return | Shared byte cursor preserved |
| Cancelled queued ShellInput view | No borrower return, max concurrent next 1, owner returns once | Shared lease/cancellation preserved |

The opaque cases release/reject every harness gate in cleanup. Later read/return
rejections were observed; zero unhandled-rejection events were recorded under
`--unhandled-rejections=strict`. No arbitrary grace period is proposed as a fix.

## Minimal owner proposal — not implemented

Request source ownership for **`src/shell/input.ts` only**, plus focused shell
tests. Keep one shared return-completion promise, but do not transform its
rejection into fulfillment. Attach a rejection observer to that same promise
for the intentionally non-awaited pending-read/aborted paths. Await the original
promise only on the existing non-pending-read, interruptible close path.

Keep all existing surrounding policy:

- Preserve exact caller reason and selected execution rejection; do not replace
  them with late cleanup errors or unwrap/relabel nonzero command statuses.
- Preserve EOF, idempotent return-once, borrower non-ownership and serialized
  shared reads. Do **not** add `.return()` to every borrowed iterator.
- Do not await an opaque pending next/generator return during abort/dispose, or
  silently register raw external iterators as cooperative owned callbacks.
- Recheck undefined/null rejection, late rejection observation, source errors,
  budgets, sequential stdin and the unchanged lifecycle scope after a fix.

**No API addition is required to stop ordinary return-error erasure.** If root
wants the stronger external-return retirement barrier, define it separately as
explicit cooperative ownership. A host that actually owns a cancellable producer
can already register an idempotent retirement callback before acquisition through
an appropriate command/middleware scope; its callback must first unblock owned
reads, then await retirement. Calling an opaque async generator's `.return()`
alone is not such a protocol. Any new Shell-level input-ownership option would
need separate contract/owner approval and tests, not an implicit ByteSource change.

## Frozen execution and retained evidence

Both attempts use installed Darwin arm64 Node24.11.1 at
`/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node`, SHA256
`4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0`.
Each uses a fresh regular-file Git archive, 314 authenticated development-tool
files and a fresh successful production build. There is no dependency install or
live/dist reuse. The final archive has 237 committed source/config/test/document
files. 181 load receipts bind the diagnostic entry and actual compiled modules
to that build; the diagnostic loader rejects paths outside its compiled candidate
and entry. These are compiled-module tests, not a moved-package export review.

`attempt-1` is retained byte-for-byte. Its automatic counter expected TAP but
Node24 selected the spec reporter: the raw output already says 63 tests/63 pass,
while its `unchangedCounts` is `{}`. `attempt-1/run.mjs.txt` preserves that exact
runner. `attempt-2` requests TAP explicitly, asserts the 63-test denominator and
also executes the original column reproduction unchanged. No product expectation
changed between attempts; the diagnostic `probe.mjs` is identical.

Final interval: `2026-08-27T15:41:04.252Z`–`2026-08-27T15:41:10.383Z`.
Candidate files, modes and directory inventories are equal before/after tests,
including detection of **new entries**, not just old file hashes. Original column
HOLD and all nine error-loss observations remain in the captures. All bounded
top-level child commands closed without timeout/spawn failure; controlled gates
were released, and owned temporary archives were removed. Foreign working-tree
changes were not staged, modified or removed.

To replay, choose a new directory:

```sh
node tests/integration/shared-external-stdin-review-20260827/run.mjs /tmp/UNIQUE-stdin-review
node tests/integration/shared-external-stdin-review-20260827/verify.mjs
```

The runner exits zero for reproducing the diagnosis, **not for fixing the nine
defective rows**. The static verifier authenticates all 237 committed input blobs,
loaded-byte receipts and exact evidence inventory (including new entries). It
does not execute the cases again or turn the preserved HOLD into acceptance.

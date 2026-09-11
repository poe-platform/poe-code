# Issue 648: bounded PATH lookup with execution-local caching

Author: kamilio. Title: PATH command lookup walks every component with uncached
stat+access. Implementation and focused validation: September 8, 2026.
Git, integration registration, lint/build orchestration and delivery belong to root.

## Validated current defect

Fresh MemoryFileSystem counters reproduced three failures before implementation:

- One missing command with 9,000 nonexistent PATH directories dispatched 9,000
  stats, rather than the requested maximum of 64 consulted components.
- Two identical negative lookups dispatched four stats for two candidates,
  rather than two stats reused within the execution.
- Two positive discovery lookups dispatched two stats rather than one. Both
  must still perform their own executable-access check.

The report's missing-filesystem-ledger claim is not current: issue 621 already
introduced `maxFileSystemOperations`, with a 100,000-operation default and
10,000-operation Worker profile. This change retains that ledger and its scoped
filesystem wrapper. It adds neither a second operation budget nor a bypass.

## Policy and implementation

- `ShellLimits.maxPathComponents` defaults to 64 in both normal and Worker
  profiles. Existing Shell constructor/exec limits carry the same override.
  Zero rejects PATH consultation; explicit slash-containing paths bypass PATH.
  Exhaustion raises `ShellLimitError("maxPathComponents")`, not a misleading
  command-not-found result. Finding a command early does not consult the tail.
- Preserve existing full-PATH `maxExpansionBytes` and `maxExpansionFields`
  admission before lookup. Scan separators without materializing `split(":")`.
  Thus an excessive field count still fails before filesystem dispatch, while
  the 9,000-field default-admitted case stops before candidate 65.
- One bounded metadata cache belongs to the existing per-exec Budget and is
  shared with nested interpreters, substitutions and pipeline runtimes. Keys
  are resolved absolute virtual paths, not command names. Relative and empty
  components therefore follow the current cwd; changed PATH order is consulted
  anew. A new exec, including a filesystem override, receives a fresh cache.
- Retain only file/not-file metadata and ENOENT/ENOTDIR misses. Do not cache
  authorization failures, backend errors, script contents or access results.
  Positive hits always perform access again, with X_OK for execution/discovery
  and R_OK for source. Script loading retains its fresh stat, access and read.
- Bound retention to 256 entries and 64 KiB of UTF-8 key bytes plus a fixed
  64-byte charge per entry, evicting oldest entries. Oversized keys are not
  retained. These are logical cache bounds, not an exact JavaScript heap/RSS cap.
- Every actual stat/access/read still passes through the existing shared
  filesystem ledger. Cache hits avoid only the metadata operation that is no
  longer dispatched. Cancellation is checked before hits, during PATH scanning
  and after stat settlement; runtime interruptible waits retain prompt abort.
- Clear metadata before shell output creation and suspend caching until output
  finalization. Clear and suspend around registered opaque commands and
  middleware, including shebang dispatch, through their complete invocation
  cleanup. A small synchronous invocation finalizer resumes caching after
  cleanup/work/children settle; it does not re-enter close or detach a rejecting
  promise. Concurrent opaque execution disables cache insertion globally for
  that exec. Generation checks prevent an older in-flight stat from repopulating
  the cache across an observed mutation boundary.

Shell `command -v`, `type`, execution lookup and source use the shared bounded
lookup. The separately registered `which` command is outside this implementation
scope and retains its existing independent component/byte limits (4,096 default
components), permission checks and shared shell filesystem ledger. Its existing
tests and new integration controls verify that behavior; it does not use the
new shell metadata cache or the shell's 64-component limit.

## Freshness boundary

Invalidation covers shell-managed writes and opaque registered command/middleware
lifetimes, including writes through a separately captured reference to the same
filesystem. It deliberately does not infer backend revision numbers or claim
freshness for concurrent mutations performed outside those observed lifetimes,
including autonomous remote/backend changes or arbitrary caller stream callbacks.
Such backends do not expose a revision/snapshot contract. Existing stat/access/read
sequences are not atomic filesystem snapshots either. No cached access grant is
used, and no host filesystem fallback is introduced.

## TDD and focused verification

`tests/shell/path-lookup-budget.test.ts` contains 34 MemoryFileSystem tests:
caps, expansion admission, positive/negative reuse, shared/reset budgets, cwd
and empty PATH, opaque creation/removal/chmod/symlink changes, substitutions,
nested shell, redirects, middleware, concurrent pipelines, source permissions,
access denial, abort identity, bounded retention, which independence, in-flight
generation invalidation and falsey cleanup failures.

Additional fresh RED controls caught four recursive-close calls (two calls
instead of one for undefined/null/false/zero cleanup failures), and disabled
caching persisting past output finalization (three stats instead of two). Both
were corrected before the final focused pass.

The new 34 tests plus the existing 52 filesystem-budget tests pass: 86/86.
Tests create only virtual MemoryFileSystem fixtures. No README changes, lint,
build, commits or pushes are performed by this worker.

Use Node 22 from `/tmp/kamilio-toolchain.path`. The focused maintained route,
run from `packages/safe-bash`, is:

```sh
PATH="$(cat /tmp/kamilio-toolchain.path)/bin:$PATH" \
  node scripts/test-reporting.mjs --import tsx --test-concurrency=1 \
  tests/shell/path-lookup-budget.test.ts tests/shell/filesystem-budget.test.ts
```

Sandboxed isolated child processes initially failed without useful diagnostics;
an in-process focused run supplied the RED/GREEN counters. Compatibility checks
use the normal isolated runner outside that sandbox. An initial compatibility
attempt from repository root had one cwd-dependent source-hash fixture failure
(`src/shell` missing), with 479 tests passing; rerun from the required package cwd.
That corrected run passed 529/529 across 15 files: PATH/filesystem budgets,
invocation modes/discovery, cleanup lifecycle/pipelines/setup, source behavior/
diagnostics and which behavior/limits/safety. The earlier sandboxed in-process
mixed-suite attempt is not acceptance evidence: its public-snapshot setup hook
hit child-process EPERM and consequently failed all 496 tests in that shared
process. Public snapshot verification remains with root's maintained gate.
Root owns the full maintained gate and any release/delivery claims.

## Root integration checkpoint

The issue is isolated from the separately owned issue 649 changes and rebased
onto `0625512de94fd0a7abbe62011a7f81990f233013`. The new test is registered by
literal path in the maintained integration inventory.

The first normal build exposed an upstream dependency missing from the local
installation (`@petamoriken/float16`), not a source change for this issue. After
`npm ci` aligned the installation with the committed lockfile, `npm run build`
passed, including the normal workspace closure and root suffix stages.

The first full unit attempt inherited `NO_COLOR=1`; Vitest's child color setting
caused Node warning lines to break seven process-launcher output assertions.
The isolated ten-test file passed unchanged after unsetting `NO_COLOR`. The
contaminated full attempt was stopped and retained; a fresh maintained `npm test`
is required rather than counting that interrupted attempt as a pass.

An independently exit-checked smoke run verified the 64-probe cap, repeated
negative reuse, positive-hit permission rechecks, and the existing zero-operation
budget. Its terminal screenshot was captured and visually inspected. An earlier
smoke attempted during a build encountered a temporarily unavailable generated
SafeJS entry; it was not counted as passing evidence.

The next full unit attempt passed 40,035 shared tests but failed three
real-filesystem guard fixtures under the shared system temporary directory.
All 272 guard controls passed unchanged with the existing isolated validation
`TMPDIR`; this was an environment correction, not a product or assertion change.

The final uncached `npm test`, with `NO_COLOR` unset and the isolated `TMPDIR`,
completed with exit 0: 40,038 shared tests passed (42 skipped), all 279 Bash runner
controls passed, 21,519 Bash tests passed (63 skipped), all 288 terminal tests
passed, and both native root posttest stress controls passed. The maintained
orchestrator selected and executed the declared workspace lifecycle tasks;
optional skipped profiles are not counted as passes.

The final maintained `npm run lint` completed with exit 0, including guarded
ESLint, root type checking and workflow lint. Build, unit and lint validation
therefore all passed for the isolated issue 648 candidate before delivery.

## September 8 strict-type follow-up

The maintained SafeBash typecheck during issue 657 integration reported TS7006
on the path/options parameters of this issue's mocked stat callback. Explicit
types from the existing FileSystem.stat contract preserve its runtime behavior,
cache-generation race, cancellation and identity assertions. The original
failing typecheck is retained in
`/tmp/kamilio-657-final-gate.LSENd8/typecheck.log`; no product code changes.
All 34 focused runtime tests passed after the typing correction.

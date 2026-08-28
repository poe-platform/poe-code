# Candidate-specific source audit, 2026-08-28

Read-only audit of the ten admitted XAN TypeScript files at
0ec84fc38c3fafd75776d80148d4f3c2d77e6247, with baseline contracts/Shell at
5137a74ec855a32d8a8860eb66b62eb44d11e290. Line references below are to those
immutable files, not an assertion about another live checkout. No instrumentation,
source changes, public counters or private engine hooks were added. This document
does not turn static inspection into executed coverage.

## Actual bindings

- `index.ts:81`: createXanCommand returns a CommandDefinition with literal argv
  execution; createXanCommands and xanCommands compose the same local definition.
  `options.ts` supplies the exact 18 defaults/ceilings. Factory collision/replacement
  and configuration controls use actual CommandRegistry, not an author oracle.
- `io.ts` constructs InputScope and registers its idempotent close before opening
  file sources. Borrowed stdin is forwarded with next only; owned file iterators
  are managed separately. Scanner buffers cells before producer advancement;
  Bytes growth reserves new capacity while old storage remains live. Retained
  source/row/tail data and Buffer-view reuse are exercised by the frozen case jobs.
- `io.ts` preflight observes actual FsError and invokes baseline
  compareObservedEntries. Complete scoped identities bypass comparison calls;
  missing output uses actual `wx`, never a probe followed by `w`. Existing output
  requires distinct input identity. The mock wrappers preserve capabilities and
  bound backing operations; copy-up-labelled probes allocate a genuinely separate
  complete backing store, not a new client-specific identity over the same data.
  They do not certify a lazy overlay's mixed read/write authority.
- `io.ts` fallback retains copied segments, reserves segment metadata and assembly
  simultaneously, then performs one writeFile. Streamed publication may preserve
  an acknowledged prefix after failure. Neither route promises rollback.
- `index.ts:36` selects caller cancellation first, then execution failures and
  mapped FsError/XanError paths. Public settlement is additionally controlled by
  baseline Shell invocation scopes. Direct-context observations alone do not prove
  public exec/dispose or local-invoke provenance.

## Narrow source-bound work and capacity witnesses

For `count` on bytes `61 0a` with default header handling, the source's explicit
work charges are: argv UTF-8 inspection 5; scanner bytes 2; Writer.text sizing 2;
Budget.encode sizing 2; encode writes 2; managed output delivery 2. Total **15**.
The maximal explicitly charged simultaneous storage on this path is one scanner
slot 32 plus one count-row slot 32, **64**. No decoded/raw cell backing is allocated
for count; the row is freed before the two output bytes are constructed. Actual
jobs run limits 14/15/16 and 63/64/65 respectively. These are source-counter
boundary witnesses, not an exhaustive normative ledger or RSS measurement.

Error-path audit: `index.ts:48` first sizes diagnostic text using the already-used
work budget; `index.ts:50` reserves the diagnostic while input scope cleanup has
not yet run; `index.ts:53` allocates encoded parts concurrently. A diagnostic
LimitError is swallowed at `index.ts:64-66`; cleanup occurs at `index.ts:73`.
Thus a runtime-limit error can become status 1 with empty stderr even with ample
local output quota. The cohort records the exact lower-bound outcomes; final
findings must distinguish the frozen output-only diagnostic predicate from other
inherited work/capacity limits rather than silently redefining either.

## Whole-path accounting and checkpoint gaps not certified

The frozen work requirement is not established by the simple count witness:

- `argv.ts:82-90,102,117-119` performs indexOf, substring construction and path
  scans outside additional explicit work/capacity admissions. `selector.ts:10-14`
  performs regex/replace/BigInt conversion without receiving a Budget. The existing
  earlier textSize charge is not independent evidence that repeated inspections
  or simultaneous retained strings were charged. No engine-level allocation or
  string representation guarantee is inferred here.
- `argv.ts:107` reserves 32 for an explicit operand slot, while the implicit
  default operand is appended at `argv.ts:114` without that reservation. The
  count-path 64-byte witness therefore describes the implementation's explicit
  counters, not proof that all owned argument spans satisfy the normative ledger.
- `selector.ts:117-124,129,144-147` has loops without an outer checkpoint. The
  comparison helper at `selector.ts:98-100` returns immediately on a mismatching
  byte before its checkpoint. With many one-byte nonmatching columns, these loops
  can accumulate work without a macrotask yield. Budget.work checks an already
  aborted signal, but only Budget.checkpoint at `budget.ts:26-28` performs the
  promised cooperative setImmediate yield. This is a concrete source-audit gap in
  the 65,536-unit yield contract; no wall-time or timer-latency proof was executed.
- The simple source ledger is not the full header/string/index/ring/fallback
  overlap ledger. Default maxWork and maxRetainedBytes target jobs remain explicit
  unmet source-ledger prerequisites, never synthetic or default-runtime passes.

## Reviewer defects retained, not product bugs

1. Initial source compilation omitted **read** permission on its fresh output
   directory. TS directory creation therefore failed despite the correctly narrow
   write grant. The failed 880 TS5033 diagnostics and four top-level emissions are
   retained. The separately sealed correction is described in COMPILER-ADDENDUM.md.
2. File-phase bridge `adapter.mjs:72` appends `-o out.csv` after the frozen selector
   argv's `--`. Those tokens become positional operands. The command correctly
   reports too many input files; those 45 probes per layout do not exercise the
   intended file/header phase, regardless of empty output or unchanged namespace.
3. The inherited workflow bridge and new origin middleware await next but discard
   its CommandResult. Baseline `contracts/plugin.ts:6-9,56-59` requires returning
   that result. Correct output bytes plus a host-generated undefined-exitCode
   diagnostic are a harness defect, not a CSV command failure. The same middleware
   style in lifecycle/parent/invoke probes limits interpretation of otherwise
   recorded cancellation/cleanup and environment observations.
4. Several previously sealed semantic regex matchers reject ordinary equivalent
   language (for example `selected nothing`, `does not exist`, `requires headers`,
   long option names or `Could not deserialize`). Original FAIL results remain
   unchanged. No matcher amendment, rescore or retry occurs; these are not grounds
   to demand new exact diagnostic spellings from the product.

The first three defects are this reviewer's responsibility, not missing user
policy or missing public exports. Their affected obligations stay unmet. The
actual cohort proceeds through independent intact/reaped cases without converting
either defective or ambiguous probes into passes.

## Actual-parent qualification boundary

The actual parent calls the previously qualified admitFinal, unlike the V1/V2
preparation omission: it verifies exact job/phase/nonce/manifest, required IDs,
counts, final-record position, closure, completion and append-aware artifact
integrity for every runtime batch. The original missing-finalization/exit-zero
hole is therefore exercised through the actual path, not just a synthetic helper.
However, the new parent's final aggregate does not separately include a child
nonzero exit when that same child claims all required cases PASS. The worker in
this run derives its exit from its case failures; the final evidence must check
that those channels actually agree. The 12 controls did not qualify the
nonzero-exit/all-PASS inconsistency. This is an additional reviewer-parent audit
gap, not permission to call A01 universally closed or to rerun the cohort.

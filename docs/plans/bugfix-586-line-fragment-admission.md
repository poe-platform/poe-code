# #586: bounded line-fragment admission

## Scope and status

Initially implemented on `e8254241c175ad153c2650dd1f37c9c450f61ab9`, September 4, 2026.
The short-complete-record repair on `6bba02cfb1a332ccdf84b3c8dd8f184b89a32616`
supersedes that first freeze; its evidence remains unchanged.
The shared `RecordBuffer`, `internal.ts` line reader, and `text.ts` sort collector
replace retained per-fragment copies with lazy owned 4 KiB segments. Incoming
spans are admitted in full before allocating or copying; the final segment is
capped to remaining logical capacity. Segments retain only unfinished fragments.
Completed spans pass directly to `finish(admit, bytes, start, end)`, which checks
combined pending/final length, aggregate admission, and finalization overlap
before allocating the output or copying the borrowed span. A complete short
record needs no scratch segment. Borrowed producer bytes are copied before the
next source read. Final outputs own independent exact-size storage.

The logical line capacity remains 32 MiB. Before exact output allocation,
`finish()` explicitly checks allocated segment capacity plus output length
against its finalization capacity (default twice the logical capacity). This
allows an exact-capacity record; it is a typed-payload overlap policy, not an RSS,
GC, object-metadata, producer-buffer, or whole-command memory guarantee.

Both drivers release pending segments in `finally`. Empty terminated records,
LF/NUL framing, nonempty unterminated EOF records, early iterator closure, and
source/cancellation identities are preserved. Ordinary callers of `lines()`
retain their existing behavior; its optional third argument is internal admission.

## Pre-materialization contract and #601 merge

`RecordBuffer.finish(admit?, bytes?, start?, end?)` synchronously calls
admission once for each completed record, before allocating/copying its exact
output and before accepting/yielding it. Existing pending segments may already
exist. An empty terminated record calls admission with zero; empty EOF does not
produce a record. A throwing callback prevents materialization and escapes through
producer cleanup. Successful admission does not promise allocation success or
rollback of callback-owned reservations after a subsequent failure.

`collectSortRecords(source, delimiter, admit, accept)` passes the callback to
`finish`; sort check mode passes the same callback through `lines`. The callback
is local to one sort invocation, shared across its input files. It checks
cancellation, validates remaining aggregate payload capacity including the
existing one-byte separator charge, and only then increments that aggregate.
Admission is at completed-record boundaries, not an indiscriminate chunk-size
rejection. Normal and check-mode status/error handling remain unchanged.

#601 was delivered separately in `47a8017df` (root reports upstream
`e217568e9`). Read-only inspection confirms `SortRecordBudget.admit()` shares a
100,000-record cap and 32 MiB payload-plus-separator cap across inputs. Root owns
the merge. Preserve that budget, cancellation before admission, and its collector's
boolean completion result with awaited asynchronous `accept(...) === false`
early exit, including `-c`. Wire its budget into the pre-materialization callback,
not into post-materialization acceptance. #586 adds no metadata policy. #587's
cut decoder `ignoreBOM: true`, its tests, and other text logic are unchanged.

Pending-fragment consideration: local and upstream code currently use the line
capacity while accumulating an unfinished record, then admit aggregate storage
at completion. Upstream `admit()` consumes both budgets and exposes no remaining
capacity/check-only API; calling it per fragment would incorrectly count records.
A future pre-copy pending check needs non-consuming byte-budget validation with
the existing sort error classification, not a reduced line limit or duplicate
record charges. This repair does not introduce that separate budget API.

## Focused evidence

Initial private evidence directory (historical first freeze):
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/tmp/issue-586-implementation.7ShKVE`.

- `red.log`: two behavioral failures before production edits; eight one-byte
  fragments retained eight owned copies in both lines and sort.
- `green-initial.log`: all 29 new bounded tests pass after implementation.
- `green-focused.log`: 69 pass (29 new, 38 cut-BOM, two borrowed-sort controls).
- `green-ordinary-filtered.log`: 14 explicitly selected ordinary line/collect,
  sort, uniq, and cut controls pass. The existing 32 MiB test was not run.
- `types.log`: focused strict NodeNext no-emit TypeScript check exits zero for
  all three changed source files and the new test file, including imports.
- `commands.txt` records commands/environment and observed exit statuses;
  `source-freeze.sha256` and `evidence.sha256` bind final source and evidence.

Tests use tiny configurable helper capacities, an approximately 4 KiB segment
boundary, and eight-byte producer reuse. Sort aggregate boundary controls inject
a synthetic prior logical charge through the actual admission callback while
materializing only zero/one-byte records; they do not allocate a 32 MiB fixture.
They cover exact acceptance, separator-only overflow, EOF separator charging,
reject-before-allocation/copy, output stability, cleanup, and falsey cancellation.
No CPU/RSS/OOM, crash/stress, broad-gate, build, or full-typecheck claim is made.

Root must register the new literal canonical path:
`packages/safe-bash/tests/commands/line-fragment-admission.test.ts`.
Root retains Git, full guarded gates, release, and issue closure ownership.
Both line and sort work are ready for root review; no commit or push was made.

## Short-record repair evidence and final freeze

Current evidence directory:
`/home/kjopek/kamilio-validation-569-575.RoFXyZ/tmp/issue-586-short-record.bvqMV0`.

- `red.log`: nine behavioral failures before repair: eight/sixteen complete
  records through lines, sort, and sort check mode, plus three direct-final-span
  admission/ownership controls. The eight-line case reproduced `[4096, 1]` per
  record, totaling 32,776 typed-array bytes for eight output bytes.
- `green-initial.log`: all 38 #586 tests pass. Complete records allocate only
  exact output bytes; sort's existing 64 KiB output staging remains unchanged.
  Fragmented unfinished records still use 4 KiB segments, not a smaller slab cap.
- `green-focused.log`: 78 pass (38 #586, 38 cut-BOM, two borrowed-sort controls).
- `green-ordinary-filtered.log`: the same 14 ordinary controls pass.
- `types.log`: focused strict no-emit types exit zero. `commands.txt` records
  commands/environment/statuses; `source-freeze.sha256` binds all five final
  owned files, and `evidence.sha256` binds this repair's evidence.

The direct-span tests reject before copying/allocation for line, aggregate, and
overlap failures, include pending bytes in admission, and verify exact-capacity
acceptance and independence from reused producer storage. No broad gates,
builds, Git mutations, or large/stress probes were run for this repair.

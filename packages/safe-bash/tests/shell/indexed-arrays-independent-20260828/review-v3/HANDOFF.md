# Root handoff: design review, not implementation GO

Preseal `100685da` precedes the one static audit. `STATIC-RESULT.json` preserves
its actual command, stdout, empty stderr, exit0 and null signal/error. Six named
committed blobs authenticate; three scalar-operator source sections match exactly
between LET and accepted DOTGLOB; declared PEAK arithmetic agrees:
metadata2560 + payload50 =2610, forward256 + release189 =445. These are **static
checks**, not product/ledger passes or a complete memory bound.

## Closed / conditional

- G1 is closed by root's staged/static-vs-dynamic overflow/no-op/precedence choice.
- G3 is conditionally closed by root's whole-state epoch choice; actual complete
  mutation coverage remains required, now explicitly including `dotglob` writes.
- G4's split E/private ownership and cooperative-loop-only claim is closed by
  root. No RSS/combined bound/hard primitive preemption is inferred.
- G2/G5 are feasible but not mechanically certified by the declared peak alone.
  Require tentative **shared** generation/version/epoch reservation; last
  external-observer detach despite the table's strong reference; explicit
  dependency ownership/acyclicity; prepaid restore and one-shot overlapping drain.
  Small synthetic traces can settle these before any product implementation.

## Narrow decisions requested

1. G6: ratify watch-table slots under F; ordered exact/lazy derived-cap errors;
   atomic reservation checks with no refund of earlier successful reservations;
   precompute maximum deletion before publication. The complete proposed order
   and relevant boundary cases are in `DECISIONS.md`.
2. G7: ratify the listed control/export/prefix/typed-local/listing effect phases;
   explicitly scope the new same-value overlay ownership rule versus unchanged
   scalar-only restoration; pre-admit zero write plus readonly attribute update.
3. G8: **recommend preserving supported bare-name scalar operators as zero views**,
   not the author's blanket refusal. Exact supported tokens and length/substring
   forms are listed. Selected `=`/`:=` keeps RHS-before-readonly, expands once,
   then checked zero publication with readonly-before-stale and no retry. Missing
   zero remains undefined, empty zero remains set; nonzero members/kind survive.
   Preserve both `part()` and `word()`'s lazy alternate-splice path. Explicit
   indexed operators and array arithmetic still refuse. Array-derived helper
   intermediates must be charged, not relabelled existing E.
4. Approve the concrete left-to-right splice vectors, including two-plus-two
   members yielding three fields, empty/quoted-empty boundaries and Unicode IFS.

Prepared **17 splice +16 zero-view vectors and22 mechanical obligations**, all
unexecuted and pending the stated choices. No native/product/package execution,
mutant kills, new APIs or source window. Existing N13/native differences, 14 exit0
+2 exit127 observations, five static supervisor gaps and
`STOPPED_FINAL_INTEGRITY` remain unchanged; none is relabelled a product pass or
an observed copy/cleanup incident.

Only the independent review subtree changes. No active child/service or temporary
source copy remains from this task. Historical independent/author evidence and
foreign working-tree/index entries are outside the write set.

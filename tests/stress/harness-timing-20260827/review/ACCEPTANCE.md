# Independent harness-only acceptance freeze

This verifier owns only new files in this review directory. No subagents,
product edits, canonical edits, shared helper edits, or author evidence edits.
Criteria below precede the author-ready handoff; author passes are not the
source of expected results. Static baseline is `7e828a4`, fullgate routing is
`51282a9`, and the regex checkpoint `c467e8a` remains NO default acceptance
with F1 invocation-cleanup and glob/walk ownership blockers.

## Immutable semantic baseline

- Verify every original snapshot against its manifest hash and git object.
- Keep the historical fullgate denominator 15,958: 15,769 pass, 110 fail,
  79 skip. Preserve all 13 jq deadline failures and the native rg delivery
  failure; isolated Plato 15/15 runs do not replace fullgate outcomes.
- Freeze all 15 jq vectors and all 330 expected status/stdoutHex/stderrHex
  triples: direct/shell times whole/bytewise/split offsets 1, 2, 3, 16381,
  16382, 16383, 16384, 16385, 16386. Inputs and argv are immutable.
- Preserve maxInputBytes=65536, maxOutputBytes=65536, maxValueBytes=32768,
  maxResults=4096, maxSteps=100000 and Shell maxOutputBytes=65536.
  Existing intentional cancellation tests and shared helper stay unchanged.
  The old 1500ms signal starts after imports; it is an execution abort, not
  loader timeout. Any larger bound is a test watchdog, not product policy.
- Preserve the six streaming semantics and wrapper pass-6 assertion: three
  prefix-then-NUL comparisons, distinct whole-write warning-only result,
  backpressure, and exact cancellation reason/iterator cleanup. Warning-only
  matched delivery must still fail, never become a skip or an inverted pass.
- Freeze original native argv `rg --no-config foo -`, input hex
  `666f6f0a000a6e6f0a`, and exact binary diagnostic bytes. Preserve original
  25ms failed records. Explicitly disclose native argument/profile changes;
  a buffered-output versus line-buffered profile is not unchanged parity.

## Readiness, progress, and independent negative controls

No dynamic work before author-ready. Inspect the actual author helper before
selecting its narrow test seam; use independent tiny controlled child files
or static mutation, not eval, product process wrappers, or runtime dependencies.

1. Suppressed readiness must fail within a short injected test bound and
   retire the exact child; tool spawn is not application readiness.
2. Readiness without consumed input must not release suffix delivery. A
   child that announces startup but withholds prefix consumption/output
   must fail the actual progress handshake. Write callbacks are not reads.
3. Withheld suffix delivery must fail rather than count warning-only as
   matched native equivalence.
4. A never-ending child after genuine prefix progress must fail the finish
   watchdog and retire. All input and output are tiny benign constants.
5. Timeout plus simulated cleanup failure must retain both failures; do not
   lose the primary error or return success. An independent owner must close
   any test-controlled child even when the tested cleanup seam fails.

Record spawn/startup, readiness, execution/progress/first byte, timer due and
actual fire when applicable, exit, stdout close, stderr close, child close,
and final exact-child accounting. A bounded cleanup must never use ps, broad
kill, or rely solely on child.killed. Scheduling watchdogs cannot establish
hard deadline guarantees. All six reserved pathological allocations unused.

## Fixed execution schedule and reporting

After ready, verify committed author identity and freeze consumed source/test
hashes; distinguish changes since baseline from changes during verification.
Run canonical jq and canonical streaming wrapper serially, then at most three
modest concurrent rounds. Count descendants: wrapper + streaming child + rg
can already occupy three slots. Do not overlap that topology with jq. Prefer
one concurrent jq plus direct streaming-cases round (three total children),
with canonical wrapper checked serially. Coordinate this interpretation if
the wrapper topology would exceed the user cap. No full-repository tests,
broad fuzz, risky regex, external network, or ambient user-file fixtures.

Retain every attempted result, failure, fixture correction, and command.
Stop on a substantive weakness and report a precise reproduction to root
and author; no local fixes or retries-until-green. Any expansion needs root
approval. Record unavailable evidence as a gap, not a pass. Global typecheck
failures owned by Plato are not this leaf's edit scope.

Final report gives actual denominators, profiles, hashes, timing, negative
guard results, exact cleanup, commits, and gaps. Recommendation is only for
the harness changes, never fullgate, source acceptance, or superiority.

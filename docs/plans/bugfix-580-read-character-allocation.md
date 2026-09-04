# Issue #580: remove full-line character arrays from read

## Validated defect

At `3f180b67c`, a 256-character input line under `maxExpansionBytes: 128`
materializes two full character arrays for ordinary `read` and one for `read -r`
before failing expansion admission. An instrumented in-memory execution confirms
this without a large-memory or fatal-OOM workload.

The report's buffering-limit description is inaccurate: the current line reader
uses `maxOutputBytes`, not only `maxInputBytes`. The allocation amplification is
nevertheless present before the value is published.

## Scope and compatibility

- Scan strings using UTF-16 offsets and Unicode code-point positions instead of
  materializing full character arrays.
- Keep escape positions code-point-indexed and preserve existing IFS semantics.
- Retain only requested field boundaries plus evidence of an additional field,
  preserving the final-name remainder rule and empty nonwhitespace fields.
- Replace per-character unescaping and bounded-read arrays with bounded fragment
  batches. Preserve line continuations, NUL handling, decoder errors and unread tails.
- Preserve `-n`, `-N`, `-d`, readonly partial assignment, EOF statuses, and byte
  versus character counting. Do not add an early whole-line expansion cap that
  would reject whitespace discarded before assignment.

This removes unconditional character-array amplification. The existing escaped
position set still has O(number of escaped code points) metadata; this is not a
complete RSS bound or a redesign of every read-related budget.

## Validation and delivery

Add failing allocation regressions first, then compatibility cases for astral
Unicode, escaped IFS separators, trailing delimiters/whitespace, bounded reads
spanning fragment batches, and existing byte-tail/readonly behavior. Run focused
read tests, appropriate broader shell tests, the selected workspace build and
maintained lint. Commit only this issue's paths, push main, close after verified
delivery, and monitor its release separately while continuing the middle queue.

## Results

- Red baseline: 28 of 30 read cases passed; the two allocation regressions
  observed two and one full-line arrays instead of zero.
- The completed fix passes all 30 focused read cases and 361 related I/O,
  invocation, byte-value, and cleanup tests.
- All 2,003 broader shell/value-contract tests passed, with no failures or skips.
- The selected `virtual-bash` workspace build passed.
- Independent review matched the old behavior in 100,000 randomized field scans
  and 10,000 unescaping cases, including Unicode and escaped-position indices.
- Guarded root ESLint completed with 9,619 configured files, zero errors/warnings,
  and all 25 receipt boundaries processed. `git diff --check` also passed.

The additional maintained package-wide typecheck exited 2 with 24 diagnostics
in untouched legacy fixture sources, including missing oracle modules. No
diagnostic names a changed #580 file; consumer checks reported their expected
outcomes. The overall typecheck is failed, not waived or called green. This
separate current failure is recorded in #605 for baseline and ownership-aware
investigation; no unrelated fixture changes are included here.

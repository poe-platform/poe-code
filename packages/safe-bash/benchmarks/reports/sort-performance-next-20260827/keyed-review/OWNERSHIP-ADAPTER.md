# Bounded ownership adapter freeze

Root authorizes exactly the two already-frozen borrowed inputs through exported
`createStandardCommands()`'s real sort handler with a legitimate CommandContext.
The source bytes, literal argv, offset allocation, chunk widths, producer reuse,
finalizer overwrite, output bytes/status/stderr and empty filesystem effects are
unchanged. Only the call boundary changes: no Shell stdin copying layer obscures
sort's own record retention. The original Shell cases remain distinct, untouched.

`direct-worker.mjs` is frozen before execution. Run two positive controls on each
actual moved baseline/candidate, then the same two already-defined collector
mutants (each with both frozen inputs). Retain original mutation12/14, including
two surviving Shell-wrapper mutants. Supplemental direct2 is not a rewritten
original14/14 result. No extra inputs, schedules, native probes or product changes.

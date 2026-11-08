# G18: source correction, not a rebaseline

The original source-sealed cohort completed 23/24 pure binding groups. G18
expected an in-flight PIPESTATUS publication to reject after
`state.variables.OTHER = 'concurrent'`; it fulfilled instead. The exact original
assertion and result remain in pure.mjs and PURE-RESULTS.json.

Cause: BindingWatch validates the watched name, while the ratified conservative
array conflict profile additionally requires the whole-state epoch. The new
helper checked target kind and watch validity but omitted that epoch comparison.
The source correction captures StateMonitor.epoch before the first awaited
staging operation and compares it again before the synchronous publication.
It does not change counters, root ownership, targets, captures, ERE, arithmetic,
or failure expectations. This is a pure-helper finding, not an executed public
Shell counterexample.

The one authorized strict build already completed on the original helper. The
corrected helper is SOURCE-ONLY: not recompiled, imported, or rerun in this grant.
The retained candidate/build/package projection is the ORIGINAL source seal;
do not relabel its output as a corrected source build. A new strict build and
unchanged G18 replay are required, followed by independent public/runtime review.

# Unit2 resolved subset, author contract (not GNU goldens)

2026-08-29. Root ratified finite e/u +/- clusters and terminal o consuming `errexit`, `pipefail`, or `nounset`; existing positional/-- behavior, e/pipefail rules, default nounset-off remain. Base c83 plus exact provisional unit1 1e9b83, not live HEAD; unit1 acceptance is still separate.

New parameter reads use a presence check, never a blanket variable-lookup ban. Empty values and legal lazy default/alternative/assignment paths do not fail merely because the original value is missing. Ordinary aggregate @/* expansion is exempt. Scalar, positional and explicit element reads, value-consuming scalar length/pattern/substring paths have the new check. Existing array aggregate-length behavior remains untouched and UNQUALIFIED for nounset. Arithmetic bare-name reads/assignments and LET are NOT changed; no nounset-arithmetic compatibility claim.

The provisional noninteractive product choice is one active-stderr budgeted diagnostic and private fatal status1. The private exit propagates through functions/source/eval to the same logical boundary. Isolated subshell/pipeline/substitution boundaries consume their own exit, leaving existing e/pipefail rules to determine parent continuation. Diagnostic-write rejection has a private transport control, unwrapped at root/public invoke boundaries; it is not converted to an exit status or exposed as a public error class. Caller abort and ShellLimitError remain raw. Only this new diagnostic path preserves its primary write failure if command-owned input cleanup also rejects; existing cleanup barrier/priority is not replaced.

Current `set` scanner validates each new cluster token before applying it. Earlier valid tokens retain effects on later invalid input. This necessary implementation behavior is **not** a ratified/native invalid-tail mutation contract; all such rows remain OPEN. No-arg/listing set forms, startup bash-u, local-, SHELLOPTS, interactive modes, [[ ]], declare/typeset/mapfile and other strict flags remain outside this subset. `$-` reports supported e/u bits, not invented native default flags. Exact GNU diagnostic/status/line bytes remain OPEN; only the existing optional parser line field is populated for plain parameters.

## Frozen role split

Unchanged 50 design identities are authenticated from `90c10991` CASES SHA256 `99468cfc96e56130fa65ce12835f4d8a3740002ec9519ea306d4e120cbe5adff`.

- KNOWN_PRODUCT_SELECTION: U01–05, U08–16, U18–26, U29–30, U37–50 =39. Their author assertions encode root policy/basic literal effects, not implementation-derived native observations.
- UNEXECUTED_OPEN_OR_OUTSIDE: U06 invalid-tail mutation; U07 listing; U17 existing explicit-error status profile; U27–28 aggregate length; U31–36 arithmetic/LET =11. They are not skips-as-passes, deleted requirements, or proof of compatibility.
- E01–E11 are eleven separately named author controls: active file stderr, here-string, ordered file effects, lazy array-zero guards, function option state, fatal-if, heredoc, nested sink rejection, public invoke raw rejection, primary sink versus cleanup, substitution with existing-e. E08 has three programs; U49 has two reasons. Report identities and executions distinctly.

New executed corpus is39+11=50 identities per layout, plus selected unchanged Git/apply/arrays/coherence and unit1-v2 author regressions. Exact old unit1 failures remain; executing its versioned fixture is new composition evidence, not rescoring old capture. Types reuse existing public consumer/negative controls; no new root API.

## Author validation envelope

Only after committed source and preseal: source build, full offline pack/install with scripts disabled, physical move, strict consumer types, actual authenticated loader traces. Native Bash/Git oracles, private/engine/Node-command execution, network and full gate are zero. Bounds45min inclusive cleanup/publication,96 total owned processes including explicit loader reservations/regex workers, peak4,128MiB capture,768MiB scratch,30s case/120s build,32 fixed loader admissions and8 authenticated regex workers maximum. Ordinary assertion/compiler outcomes may be captured; safety/integrity/capture/unknown retirement/cap stops further work without retry. No attempt is whole-Bash/whole-product acceptance.

Loaded mutations: disable missing-read check (U10), remove same-scope fatal exit (U39), ignore-u option setting (U01/U10 selected fixed U10), each exact one-site followed by restoration. Binding negatives remove root member/change runtime hash. Existing regression loaders/resource guards stay authenticated. Exact dispatch, source composition and selected tooling are sealed in SOURCE/PRESEAL/EXECUTOR before launch.

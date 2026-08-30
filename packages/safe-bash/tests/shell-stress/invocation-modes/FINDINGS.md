# Preparation findings for shellcoordinator

**Post-READY update: RED FINAL SOURCE GUARD; no current-tree acceptance.**
Imported `src/commands/filesystem.ts` changed after the stable runs in commit
`37e19b7`; the root must coordinate a fresh dependency freeze/replay. The final
audit preserves expected/observed hashes and does not waive this movement.
Recorded verification of frozen `21a6b91`: frozen
holdouts remain **69/72** (broader POSIX plus absent type/command introspection),
unmodified author tests **130/132** (existing unsupported read -N), previous file
cohorts **58/58**, targeted regressions **121/121**, and fresh global/build
noEmit both pass. No new in-scope defect was measured; no failures were hidden.
Whole raw comparisons and exact preserved failures are in `POST_READY.md` and
`post-ready-raw-comparison.json`. The earlier preparation observations below are
retained unchanged as history; post-READY runs are no longer pending.

No invocation acceptance is claimed. READY did not arrive before the bounded
wait exited; see `ready-wait-evidence.json` for actual timestamps and the slight
polling overshoot. Source edits remain exclusively the author's. No acceptance
while those files were changing, and no author expectations were inspected.

## Measured old-source gaps (not post-READY regressions)

Stable baseline HEAD: `4fa4ba9502dac843bd13aa5031d128a3171f597d`.
Runtime SHA-256: `dabbb60ffc499a7e64fae8071f12b465b5845e7246510e19da15b406f8481d10`.
All 27 actually loaded TypeScript source hashes stayed unchanged during capture.

1. `bash-c-literal-args-0`: empty command name and literal empty/spaced/meta
   arguments. Virtual returns 2 and unsupported-option stderr. Both GNU profiles
   return 0 and preserve all four args and the empty `$0` exactly.
2. `bash-read-same-chunk`: `bash -s`, with the entire source/data stream in one
   chunk: `read value`, data `command data`, then printf. Virtual returns 2 and
   unsupported-option stderr. Both natives return 0 and `read:<command data>`.
3. `path-first-usable`: `PATH=first:second; invtool value`, with two executable
   role-shebang scripts. Virtual returns 127 and command-not-found. Both natives
   return 0 and `first:value`.

`baseline-evidence.json` and `native-corrected-evidence.json` retain exact source,
argv, rendered fixtures, byte outputs, effects, process outcomes and guards.
The shell statuses above are red controls; the capturing child processes exit 0
because capture succeeded. They are not three passing invocation tests.

## Native and fixture distinctions

- Both complete corrected 57-row profiles agree stdout/status/effects; six rows
  have different raw diagnostic bytes. No oracle is chosen per case.
- GNU 5.3 and 3.2 children have independently pinned executable hashes and
  explicitly verified sh argv0/POSIX mode. Shebang headers are role-rendered and
  deliberately not byte-identical; no 5.3-parent/3.2-child provenance confusion.
- Initial malformed quoting in eight native -c fixtures is preserved verbatim
  in `native-evidence.json`; only quoting was corrected, not the assertions.
  The same whole cohort was then captured on both profiles. The unset-PATH
  preparatory naming assumption was corrected to match actual native cwd search.
- Four strict direct-execution policies are explicitly not native parity.
  Broader POSIX special-assignment semantics and previously absent type/command-v
  remain visible as scope limits, not xfails or fabricated compatibility passes.

## Resume work

After READY: run all 72 holdouts, unmodified author cohort, previous file-entrypoint
author/independent cohorts and selected targeted regressions; then global/build
non-emitting TypeScript checks, with before/after actual-import source guards.
The prepared runner documents exact commands and writes immutable JSON. Do not
rerun native probes of unchanged blocked cases while awaiting source fixes.

The five first-read custom cases, head-zero pending cases, remote audit, paused
NUL cohorts, general lifecycle API work, source/dot/eval, default whole suite and
Curie comparators were not run and are not silently included in acceptance.
All native and baseline process groups have exited; the readiness watcher exited.

# MPS import and linear model export QA

Root owns providers, package integration, export verification, evidence reduction
and Git. A separate agent stresses and repairs model algorithms with failing
regressions. No README edits, pushes or publication are authorized.

1. Verify the official Gnumeric 1.12.61 source archive SHA-256 against
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Use source only under `out`. Read `plugins/mps/mps.c`,
   `plugins/glpk/glpk-write.c`, `plugins/lpsolve/lpsolve-write.c` and
   `src/tools/gnm-solver.c`; preserve their observable quirks.
2. Use the separate isolated native oracle from the captured dependency profile.
   Set C locale, UTC, memory GSettings backend, explicit schema/library roots
   and fresh HOME/XDG roots. Capture argv, status, stdout, stderr, output bytes
   and output namespace separately. Never call native utilities from unit tests
   or product code. No mathematical solver success is an export parity result.
3. Create original small fixtures covering whitespace-split fixed/free MPS,
   omitted column continuation, repeated RHS, objective coefficients, ignored
   free bounds, explicit fixed/integer/binary bounds and integer markers.
   Check range expansion, including the native same-row equality-range bug.
4. Add a failing exact-byte regression before implementation. Test injected
   byte I/O through the shared engine and memfs for file namespace effects.
   Compare native workbook cells/formulas, sheet names and solver metadata
   after parsing native Gnumeric XML; exclude XML indentation from semantic
   metadata comparison. Qualify style preservation separately.
5. Verify active-sheet objective direction, variable order/names, zero terms,
   constant/sign/scientific formatting, constraint expansion/numbering, free
   and nonnegative bounds, duplicate integer/binary declarations. Test no-model
   output, non-LP diagnostics, numeric-evaluation and nonlinear detection quirks
   against native. Export without glpsol/lpsolve or a solver capability.
6. Test cancellation, input/output/cell/work admission, immutable SDK models,
   CLI/SDK output identity, replay and untouched VFS inputs/neighbors. Use a
   different agent for independent stress and validated repairs.
7. Run maintained selected workspace uncached builds, ssconvert workspace
   tests/lint, focused safe-bash command integration and applicable cross-package
   type/lint checks. Inspect a screenshot of virtual CLI output. Record failures
   and repairs; unsupported or unmeasured cases are never passes.
8. Reduce captures/profile/coverage under `docs/ssconvert`, record every known
   mismatch and limitation, and remove only task-owned scratch under `out`.
   Leave unrelated edits and existing oracle containers untouched.

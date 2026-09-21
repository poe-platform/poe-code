# MPS import and GLPK/LPSolve model export verification

Implemented TypeScript ESM in `packages/ssconvert`, exposed through the existing
`ssconvert` virtual command in safe-bash and the same SDK engine. Providers now
implement `Gnumeric_mps:mps`, `Gnumeric_glpk:glpk` (`.cplex`) and
`Gnumeric_lpsolve:lpsolve` (`.lp`). No subprocess, native fallback, solver executable,
LLM, or product filesystem acquisition was added. Model export is independent of
`--solve`. Existing edits and README files were preserved; no commits, push or
publication were performed.

## Reference and verified coverage

The official source archive retained under `out` was authenticated against
SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Algorithms follow Gnumeric 1.12.61 `plugins/mps/mps.c`, both solver model writers,
and numerical coefficient/coordinate selection in `src/tools/gnm-solver.c`.
The separate native oracle's dependency, plugin, locale, binary identity, original
fixtures and reversible captures are in `mps-model-reference-profile.json`.
Native utilities are only acquisition/QA tools and were never run by unit tests.

Forty-two focused tests cover original small fixtures and independent repairs:

- Whitespace-split fixed/free MPS; omitted column continuation; repeated RHS;
  rows/objective/columns; fixed and lower/upper integer bounds; integer markers;
  binary declarations; ignored FR; ranged upper/lower/equality constraints;
  NAME-only empty-model conversion. Missing ENDATA follows the source algorithm
  but was not separately measured.
- Native cell addresses, formulas, default sheet names/scopes/positions, header
  emphasis and retained Solver attributes/constraints. Native XML indentation is
  excluded from semantic metadata comparisons; full Gnumeric XML byte identity
  and all default workbook style records are not claimed.
- Active-sheet objective direction, row-major variable order, GLPK X_n and LP
  cell-address names; explicit zero objective terms; signs/constants and measured
  shortest/scientific number text; free/nonnegative bounds; integer/binary ordering
  and duplicate declarations; GLPK global and LP per-original-constraint labels.
- Native coordinate selection, one reference-step bounds, integer rounding, fixed
  coordinates, literal-RHS zero-bound quirk, and accepted polynomial secants.
  Symmetric-polynomial and nonnumeric expressions preserve native empty affine
  output, rather than implying successful mathematical linearity detection.
- Empty models, invalid input sets, invalid constraint sides/sets/range geometry,
  four exact malformed MPS diagnostics and non-LP status 1, diagnostic prefix and
  empty output-file publication. No solver-success claim is made.
- Injected bytes, memfs file effects, unchanged workbook/input/neighbors, output
  and work limits, pre-cancellation, SDK/CLI identity and virtual command replay.

The initial exact-byte engine regression failed with unknown exporters before
implementation. Independent agent regressions reproduced coefficient, bounds,
label, numeric-rendering, invalid-constraint and affine-error differences before
repair. Final repairs were separately reviewed and all focused tests rechecked
by that agent. Procedures are `docs/plans/ssconvert-mps-model-export-qa.md` and
`docs/plans/ssconvert-mps-model-independent-qa.md`.

## Final checks

All checks executed fresh; workspace build used explicit `--no-cache`:

- Selected maintained build closure: `npm run build:workspaces --
--workspace=@poe-code/ssconvert --no-cache` — passed.
- Maintained `npm test --workspace=@poe-code/ssconvert` — 229 files, 5,238 tests
  passed, including both new suites (42 focused tests).
- `npm run lint --workspace=@poe-code/ssconvert` — ESLint and source/test TypeScript
  passed. Changed safe-bash command tests also passed focused ESLint.
- All `packages/safe-bash/tests/commands/ssconvert*.test.ts` using the native
  Node test runner with tsx — 81 passed; this is focused integration, not the
  full safe-bash suite.
- Maintained root `npm run lint:types`, including declared contract checks — passed.
- Virtual CLI model output screenshot captured through the repository screenshot
  runner and visually inspected: readable objective, constraints, bounds and End.

The first package run reproduced eight obsolete provider-listing expectations;
exact expected IDs/bytes were updated, preserving independent assertions. An
intermediate run overlapped builds/type checks and timed out a numerical Tukey
case. Its isolated unchanged rerun passed; the final package run without overlapping
checks passed every test. No assertion was weakened or timeout increased.

## Remaining mismatches and unmeasured cases

Native equality-range overwrite can trigger a GLib GError-overwrite warning with
process ID and timestamp. Model bytes and status match the captures; those GLib
warning bytes are not emulated. Unknown MPS sections are ignored as in native,
but native's timestamped `g_warning` diagnostics are not emulated. These are
known diagnostic differences, not passes. An initial independent fixture with
invalid ProblemType=4 aborted native with status 134; the retained corrected fixture
uses maximize (1). JavaScript currently defaults invalid direction values to
minimization. Invalid direction 4 is a known unsupported mismatch, not a pass. Full default style/print/view XML
serialization parity is outside this cohort's verified workbook metadata.

Unmeasured: exhaustive malformed MPS record combinations, unknown-section names,
hexadecimal/special numeric tokens, every encoding/locale, recursive/shadowed names,
cross-sheet duplicate LP cell names and 3-D solver ranges, arbitrary retained Solver
shapes/type values, all objective functions, binary64 shortest-format ties, native
crashing problem-direction values, large model performance, cancellation within
host byte sinks, and optional solver execution. Header emphasis is tested;
full default workbook formatting is not. No full MPS-specification certification,
full safe-bash-suite run, or solver-result parity is claimed.

Task-owned scratch and screenshot were purged after reducing evidence. Existing
source/oracle directories and the existing oracle container remain untouched.

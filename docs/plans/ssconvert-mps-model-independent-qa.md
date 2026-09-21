# Independent MPS and model export QA

Executed September 20, 2026 by a different agent from the implementation owner.
Root retains providers, command integration and Git ownership. No push, publishing,
README edits, native product capability or host fallback was introduced.

## Procedure and reference

Use the isolated `ssconvert-statistics-qa` container through Docker context
`colima`, with repository `out` mounted at `/out`. Invoke only the separately built
`/out/ssconvert-statistics-oracle/prefix/bin/ssconvert` QA oracle, with its prefix
library and GSettings schema paths, `LC_ALL=C`, `TZ=UTC`, and a fresh QA HOME.
The source reference is the verified Gnumeric 1.12.61 archive identified in
the task; captured dependency/plugin/locale profile is maintained by root in
`docs/ssconvert/mps-model-reference-profile.json`.

Create original small MPS and Gnumeric XML inputs beneath `out`, export each using
`-T Gnumeric_glpk:glpk` and `-T Gnumeric_lpsolve:lpsolve`, and capture status,
stderr and bytes. Fixtures have no third-party model content. Unit regressions
are original in-memory workbooks/byte strings; they do not spawn the oracle,
write real files, or query an LLM. The root suite uses memfs for engine file effects.

## Verified findings and repairs

- Numeric RHS constraints retain native coordinate-selection behavior: native
  `cell_is_constant(NULL, &cr)` replaces literal bounds with zero. Original
  `A1:A2 <= 2` produces constant objective `max: 3;`, constraints `0 <= 2`, and
  distinct expanded labels `CONSTR_0` and `CONSTR_1`. Two failing assertions
  reproduced nonzero coefficients and repeated labels before repair.
- Fixed MPS bounds follow one formula-cell reference step. `FX ... X 3` with
  objective `2*X` emits `obj: 0 X_1 +6` and constraint `3 = 3`, matching native.
  The pre-repair objective remained `2 X_1`.
- `LI ... X 1.2` and `UI ... X 2.8` narrow integer coordinates to 2. Output
  contains `obj: 0 X_1 +4`, constraint indices `C_0` and `C_2`, and two repeated
  integer declarations. Native number `2.8` differed from pre-repair 17-digit
  formatting `2.7999999999999998`.
- Native shortest model-number formatting measured `1e-07`, `1e+20`,
  `1.2345678901234567`, `100000`, `1000000`, and `1e-05`. Model export now has
  separate number formatting from Gnumeric XML serialization.
- Both native writers accept quadratic secant coefficients: `A1^2+A2` exports
  coefficient 1 for each variable, status 0. This is measured exporter behavior,
  not a statement of mathematical linearity.
- Both writers emit an empty expression and complete model file for symmetric
  polynomial `A1*(1-A1)+A2` or nonnumeric `1/0`: status 0, empty stderr. Original
  regressions first reproduced thrown nonlinear errors. Affine IO failures now
  preserve native empty expressions; resource limits and cancellation still fail.
- Native `ModelType=1` exits 1 with `E Only linear programs are handled.\n`.
  This error is outside affine error handling and remains an error. Root's final
  memfs command regressions verify that both failed exports publish empty output
  files, matching native file effects as well as status and diagnostics.
- Native Inputs `UNKNOWN`, `#REF!`, and numeric `2` each export an empty
  objective with no variable bounds, status 0 and empty stderr. Three original
  failing cases reproduced a constant objective or invalid-input error. Native
  zero-length coefficient allocation returns NULL, yielding empty expressions.
- Native invalid constraint LHS `UNKNOWN` or numeric `2`, integer LHS outside
  Inputs, unknown RHS, and a one-cell RHS range paired with two-cell LHS each
  exit 0 without diagnostics and omit that constraint. Five original failing
  regressions reproduced errors or an erroneously emitted constraint before
  repair. Literal numeric RHS remains broadcast; one-cell reference RHS does not.
- Native formula input `A1=9+3` is accepted and temporarily replaced by sampled
  variable values; native target within input exports itself as `X_1`. Both
  oracle invocations exit 0 without diagnostics; the implementation already
  samples by replacing variable-cell formulas.
- Root differential regressions reproduced and verified missing sheet names
  `Print_Area` and `Sheet_Title`; these were added with native scope/positions.
- Root range regressions reproduced the wrong previous-row reference after
  advancing to the second ranged constraint. Import now resolves native relative
  row -1 at each generated constraint, preserving the native same-row equality
  range overwrite behavior.
- Root four malformed-import captures established diagnostics and untouched
  output namespace. Formatting was repaired only after those failing cases.
- Root's final geometry differential verifies equal-length ranges with unequal
  row/column shape are skipped. Final NAME-only MPS regression verifies native
  absent target, normalized `B9:B10` variable range, and empty GLPK objective 0.
- Root's header style repair was reviewed and rechecked through its regression:
  program/objective labels and variable/constraint header cells have bold=true,
  italic=false, underline=0. Serialized default style metadata is not certified.

Independent tests also verify pre-abort handling, importer/exporter work limits,
output-byte limits and unchanged input workbooks. Targeted suites and package lint
are reported separately by root after final integration checks.

Final independent recheck of root's repairs ran both existing focused files:
42/42 tests passed (21 independent and 21 root-authored). No further product edits
were made during that recheck; root retains the maintained uncached full-package
and cross-workspace gates.

## Remaining limits

This is focused compatibility evidence, not full MPS specification certification
or solver success. Native solver processes were never invoked. Root owns broader
fixed/free variants, XML metadata and Safe Bash differential checks.

Not measured by this independent cohort: arbitrary locale/encoding variations,
exhaustive binary64 shortest-rendering ties, cross-sheet duplicate LPS variable
names, name shadowing/recursive names, every malformed retained Solver record,
every supported function used in objectives, native crashes from invalid problem
direction, very large model performance, and cancellation during a host byte sink.
These cases are not passes. Full exported-workbook style/default metadata remains
outside this cohort's verified cell emphasis/geometry/name/solver coverage.

Remove temporary original oracle inputs and captured output from `out` after
root has extracted any required retained measurements.

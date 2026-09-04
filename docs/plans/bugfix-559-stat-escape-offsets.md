# Fix #559: stat escape offsets

## Scope

- Change only `packages/safe-bash/src/commands/metadata/stat.ts`, its existing
  `tests/commands/metadata/stat.test.ts`, and this plan.
- Preserve the #593 directive scanner. Replace escape suffix slicing with bounded
  reads at offsets into the original format, without adding regular expressions.
- Preserve named escapes, unknown/dangling backslashes, one-to-three octal digits,
  one-to-two hexadecimal digits, byte wrapping, and directive interactions.
- No shared helper changes, new test files, builds, staging, commits, or pushes.

## TDD and validation

1. Add deterministic, bounded instrumentation to the existing stat suite that
   checks repeated escapes do not slice format suffixes; restore mocks in `finally`.
   Bounded slices in the unchanged directive scanner remain allowed.
2. Add byte-level compatibility cases and replace the existing #593 timing
   threshold with interception that rejects any native-regexp parsing of its
   long malformed directive without executing that regexp.
3. Run the stat suite before implementation and record the expected slicing
   failure while compatibility and #593 cases pass.
4. Implement inline offset-based escape parsing and rerun stat regressions.
5. Run the adjacent metadata and relevant formatting regressions; review and
   freeze the three owned files for root integration.

## Evidence limits

The confirmed defect is repeated suffix slicing. Summed suffix lengths are not
measurements of allocated memory or proof of quadratic actual runtime. This
change does not claim a historical timing or memory improvement, publication,
or release completion.

## Results — September 4, 2026

- Red: the stat suite passed eight cases and failed only the new repeated-escape
  instrumentation: 4,096 suffix slices versus zero expected. The initial broader
  instrumentation also counted 2,048 permitted bounded directive slices; it was
  narrowed before implementation to preserve the existing scanner contract.
- Green: the stat suite passed all nine cases, including zero suffix slices,
  thirteen byte-compatibility cases with literal `-c` controls, and deterministic
  #593 native-regexp exclusion. Mock restoration runs in `finally` on both paths.
- The implementation uses original-format offsets, scans at most three numeric
  escape digits, and leaves the #593 directive scanner unchanged.
- All 59 tests passed in `tests/commands/metadata/{stat,chmod,mktemp,integration}.test.ts`
  plus `tests/commands/time-env/format-regressions.test.ts`.
- All 50 additional tests passed in
  `tests/commands/metadata-stress/{stat-human,adversarial}.test.ts`.
- Each invocation used private Node v22.22.0 via `/tmp/kamilio-toolchain.path`,
  `TMPDIR` from `/tmp/kamilio-unit-tmp.path`, unset `NO_COLOR`, and cleared local
  Git hook variables in the child environment. Tests ran through
  `node --import tsx --test --test-concurrency=1` with explicit file operands and
  external 30-second (stat) or 60-second (adjacent suites) timeout bounds.
- Whitespace validation: `git diff --check` passes for the owned tracked files.
- No full build, full-suite run, lint/typecheck, or publication is claimed.

## Freeze

Implementation and focused validation are complete. The three authorized files
are frozen for root review/integration; no further edits are planned without a
new assignment. No staging, commit, build, push, or shared-helper changes occurred.
Other workers' changes remain untouched.

# ssconvert lifecycle followup independent stress QA

## Scope and procedure

Review the final image-resolution repair independently after implementation. Keep native ssconvert as a separate QA oracle; do not add a native dependency or fallback. Original unit fixtures are small, use memfs, and invoke the actual shared CLI/SDK engine with injected byte I/O. They do not spawn utilities, write host files, or query models.

1. Inspect authenticated Gnumeric 1.12.61 `src/ssconvert.c`, especially `cb_image_export_options` and `export_objects_for_sheet`. Confirm options are checked with C `atof`, and only at graph-save time after transformations.
2. Run `npx vitest run packages/ssconvert/src/conversion/lifecycle-followup-stress.test.ts --no-cache`. Compare CLI status, stdout, stderr, SDK error identity, event order, and the entire memfs namespace.
3. Run the maintained package lint/test routes with uncached execution. Root owns the build closure, Safe Bash integration, exact candidate revision, screenshots, Git, and delivery evidence. Their results must be recorded separately.
4. For fresh native numeric qualification, use the captured dependency/plugin/locale profile and a separately acquired authenticated oracle under `out`. Combine `--export-graphs --recalc -T png -O resolution=VALUE` on an original tiny workbook, including no-object sheets. Compare status, diagnostics, and namespace. Preserve failing cases and label unavailable cells unverified.

## Executed deterministic checks

The initial focused run passed 26/26 tests in one file (34ms test execution, 576ms total). These checks cover:

- Nine source-derived numeric positive controls: inclusive bounds 1/10000, decimal-prefix trailing text, signed decimal, exponent/truncated exponent, and whole hexadecimal integers.
- Eleven negative controls exercised independently through both CLI and SDK: JavaScript binary/octal literals in both cases, zero, subminimum, overmaximum, negative, NaN, infinity, and exponent overflow. Invalid options retain status 1 and exact diagnostics after both recalculations, and create no files.
- Cancellation during explicit recalc retains the exact caller reason and stops automatic recalc, numeric validation, renderer admission, and publication. An already-aborted invocation acquires nothing.
- Combined-flag operation limits reject before input acquisition. Missing injected filesystem capability refuses inferred resource conversion. A foreign-engine workbook refuses output acquisition and preserves existing bytes.
- Unknown ordinary output extension retains status 2 before forced importer/load/recalc despite graph-option text in the exporter options.

These are product semantic/capability tests. They do not establish native cancellation or resource-budget equivalence, rendering fidelity, runtime isolation of trusted host JavaScript, or bounded performance guarantees.

The initial maintained package lint failed on this new test fixture's empty async generator (`require-yield`), with one unused-variable warning. The fixture was corrected to delegate to an empty iterator and name the deliberately omitted filesystem binding `ignoredFilesystem`; production code was unchanged. The final maintained `npm run lint --workspace=@poe-code/ssconvert` passed ESLint and product/test TypeScript. The final focused uncached test rerun passed 26/26 (31ms tests, 292ms total).

## Remaining mismatch and unavailable cells

The image-options repair consumes decimal prefixes and accepts complete unsigned hexadecimal integer strings. It still differs from C `atof` for signed hexadecimal (`+0x2`) and valid hexadecimal prefixes with trailing text (`0x2tail`), and does not implement hexadecimal fractions/exponents. This is a source-derived mismatch; no fresh native oracle was available during this followup. These cells are unverified against the captured libc runtime, not passes. No full C-number parser expansion was made in this narrow repair.

Fresh native runs, real-provider permission/alias/rollback effects, realm/checkpoint/replay execution, full mapped upstream numeric variants, format-loss warnings, independent release qualification, and CLI screenshot capture are outside this worker's executed checks. Root owns integration and screenshot validation. No skips or failures occurred in the focused 26-test run; unavailable cells are reported separately above.

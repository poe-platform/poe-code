# Native realpath oracle portability

The broad SafeJS pre-push gate reproduced a native-oracle failure on macOS:
`realpath -m` exits 1 with `realpath: illegal option -- m`. The 18 virtual
filesystem cases pass; this is not evidence of a product realpath defect.

Keep the native comparison active where supported. Set C diagnostics, preserve
the existing missing-tool skip, and explicitly skip only the recognized missing
`-m` capability. Spawn errors, signals, timeouts, unrelated command failures,
and output mismatches remain failures. Unavailable comparisons are not passes.

Validation: the original focused file had 18 passes and one failure. After the
test-only repair it has 18 passes and one explicit unsupported-oracle skip.
Focused ESLint passes. In-memory oracle controls run all 19 tests on a supported
response and reject mismatching output, unrelated errors, and timeouts without
skipping. No product implementation or maintained test membership changes.

Deliver this portability repair independently from default-function exports;
preserve the original failed full-run evidence and requalify the broad gate.

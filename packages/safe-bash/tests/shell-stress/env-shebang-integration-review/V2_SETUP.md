# Additive setup correction, before product baseline evaluation

The original freeze is commit `5339b1e75ecda072adffed689da21943235b9192`.
Its five files, seal and `baseline-6fce94f8` capture stay immutable.

Original run: all 30 product children failed at the loader guard, before the
first product module was evaluated. macOS resolves `/tmp` to `/private/tmp`;
the guard compared the canonical module URL with a noncanonical request root.
It correctly refused the unequal strings, but the fixture had not canonicalized
its own trusted root. This is **0/30 observations available, not 30 product
semantic failures**. The 23 native references and 20 actual Darwin kernel
attempts remain raw evidence; the unknown-interpreter kernel failure is retained.
All child groups and scratch were removed. No source or expectation was changed.

`product-v2.mjs` is a byte-for-byte copy of the original helper except that it
imports `realpathSync` and canonicalizes `request.dist` immediately after reading
the request. The same allowlist and actual-module-byte hash checks remain.
`run-v2.mjs` is the original driver with only versioned helper/seal wiring,
expanded freeze inputs, the explicit original baseline source commit, and
authentication of the original pre-source freeze instead of a fresh clean-live
precondition. The
original corpus, semantic assertions, host assertions, budgets and native
profile selection are unchanged. There is no broad diagnostic normalization.

`seal-v2.json` freezes this disclosed adaptation before its first execution.
Its first seal attempt refused because the author had now begun changing
`src/shell/runtime.ts`. No candidate source diff was read, loaded or copied.
The original case/expectation freeze and failed baseline attempt preceded this
discovery; a useful product baseline was not obtained before source work began.
The corrected capture is therefore explicitly an archived prepatch-source
baseline taken later, not a claim to have stopped the author's clock. The
versioned seal checks the original input digests instead of rejecting unrelated
live edits; the archived original source remains the sole product input.
The new native capture repeats the entire same primary and secondary profiles
in new isolated cwd coordinates, before product execution. It does not select
different oracles to repair mismatches. Both captures retain literal paths,
bytes, exact invocations, effects and tool hashes.

Runner for subsequent reviewers:

`node tests/shell-stress/env-shebang-integration-review/run-v2.mjs capture SOURCE_COMMIT NEW_OUTPUT_NAME`

Read-only evidence check:

`node tests/shell-stress/env-shebang-integration-review/run-v2.mjs verify OUTPUT_NAME`

The source baseline remains `6fce94f8716f1b7a8e26af78ef8cb33594ec83cc`.
Future candidates must be committed and are built from their own archive with
the same sealed cases. No acceptance or completion is claimed by this setup fix.

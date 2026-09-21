# Solver current candidate QA

## Manual procedure

1. Preserve existing edits. Verify the archive SHA-256 under out/ssconvert-lifecycle. Read released xml-sax-read.c, tools/gnm-solver.c and ssconvert.c; retain captured dependency/plugin/locale profile in docs/ssconvert/reference-profile.json.
2. Add a concrete failing signed/zero-padded enum regression before editing the loader. Use a different agent for independent in-memory model stress and source-backed TDD repairs.
3. Create original tiny XML fixtures only in out/ssconvert-solver-current. Run the separate Docker colima oracle ssconvert-statistics-qa at /out/ssconvert-statistics-oracle/prefix/bin/ssconvert with C locale, UTC, memory settings and explicit prefix library/schema paths. Capture status, stderr and exported Solver metadata. Test invalid objective, input formula and invalid constraint independently; never call native utilities from unit tests or product.
4. Exercise the shared SDK engine and opt-in virtual command with injected in-memory byte I/O. Compare diagnostics/status and namespace preservation for valid unavailable models; compare original/checkpoint/replay diagnostics on invalid models. Include signed enums and all declared model types.
5. After stress repairs, run maintained uncached ssconvert package tests and lint, explicit safe-bash build closure and focused virtual-command checks. Run full maintained uncached root test, repository lint and normal build for cross-workspace confidence. Investigate failures and report incomplete gates separately.
6. Capture and inspect an actual virtual-command screenshot through npm run screenshot (the poe-code CLI has no virtual ssconvert entry point). Keep generated evidence under out, reduce results here and remove task-owned temporary evidence.

## Candidate results

The signed/zero-padded enum regression failed before the first repair. A different agent then reproduced invalid integer attributes replacing defaults and fixed native lexical parsing, signed 64-bit bounds and signed 32-bit assignment for enums, limits and legacy coordinates. Independent review passed 63 focused solver cases and maintained ssconvert lint. Frozen model.ts SHA-256 is 7bb5925cef0666d7b17df6166f4d6bac1319997abcd7ede5f38f58c4f082d6cf; see ssconvert-solver-current-review-qa.md.

Candidate is the uncommitted worktree on main at HEAD b97c4938a469ee70e09bd08a0e5fcf7e868ca04c. Relevant test hashes: model.test.ts f4c628ac204b21e29fd12f57e1684f6e8b508a573c93ef5d3a6af4442981bc9c, model-current-review.test.ts ce8bd0a1cb7f1180b715dfe34d02429fddc9a278b71bed6dee0559d0ae795191, safe-bash ssconvert.test.ts afa82bbf105fe8d9fdacf1593312d3c719401067747b79df0e88f3879889521b. These are source identities, not new commits or remote delivery.

Fresh native QA used Docker context colima, existing ssconvert-statistics-qa and the separately installed 1.12.61 binary, SHA-256 104f1e5500432c95ac3d46a679d476d05d2bf84e7483e991d212703cb0ed131c. C locale and UTC were explicit; ldd was inspected against prefix libraries and Linux ARM64 dependencies. The existing captured profile supplies source/plugin provenance; this run does not requalify every dependency/plugin/locale variant or establish optional solver activation.

Original small XML cases independently confirmed these exact native diagnostics with exit status 0: `Solver: Target cell, A1, must contain a formula that evaluates to a number`, `Solver: Input cell B1 contains a formula`, and `Solver: Solver constraint #1 is invalid`. SDK and actual virtual Shell conversion matched each diagnostic/status, SDK/command output bytes and checkpoint/replay diagnostics. Signed quadratic model failure preserved an existing destination. The final virtual-command suite passed 63 tests, including linear, signed linear, padded quadratic and signed nonlinear unavailable models; stream SDK refused publication and memfs namespace remained unchanged. Snapshot accessor rejection, cancelled contexts, bounded work and original-workbook preservation are deterministic negative controls; no performance claim follows.

Native export canonicalized ModelType="01" and ProblemType="+1" to integer 1. ModelType/ProblemType="4294967297" wrapped to 1, MaxTime="9223372036854775807" wrapped to -1, and MaxIter="-1" retained signed storage. Invalid ModelType/ProblemType="no", MaxTime="1.5" and MaxIter="1 " retained defaults 0/0/60/1000. Native also printed four GLib warnings with pid/time prefixes; those warnings are a confirmed product diagnostic mismatch, not a pass. Valid quadratic `--solve` emitted `Solver: Failed to create solver` and exited 0 in native; JS explicitly returns unsupported-feature/status 1 without export, as required for missing JS algorithms. This is a documented parity blocker rather than successful solving.

The actual built virtual-command diagnostic screenshot was captured through the generic screenshot route and inspected: all three validation messages/status 0 and quadratic unavailable message/status 1 were readable. Screenshot inspection verifies visible diagnostics, not numerical or full native rendering parity.

The first uncached safe-bash build closure failed in optional postbuild with `compiler input identity changed: mtimeMs`: another root build route rewrote inputs during the build. This overlapping run is a failure. The final serial uncached closure passed all 18 selected maintained builds, including optional command postbuild. The normal repository `npm run build` passed all maintained workspace builds, root schema stages and bundle stages. The maintained repository lint route passed: guarded ESLint reported 0 errors/4 warnings across 16,996 configured/linted subjects, root types/contracts passed and workflow lint passed. Maintained ssconvert lint also passed after the final repairs.

After the final rebuilt artifacts, the actual virtual-command suite again passed all 63 tests with no skips/TODOs. Manual SDK/virtual command byte/status/diagnostic and replay checks passed again, now including the two-sheet SelectedTab=1 active-model case. A fresh screenshot of these final rebuilt executions was inspected and readable. Public `poe-code/ssconvert` imports expose the parameter loader and explicitly frozen unavailable registry.

An additional original 2x2 variable rectangle put formulas at B1 and A2. Native reported B1 first, independently verifying row-major validation order; SDK/virtual command and checkpoint/replay matched the exact diagnostic/status. No randomized finding was introduced; minimized original cases and lexical vectors are reproducible from this procedure and the in-memory regression cases.

The separate safe-bash consumer typecheck failed (status 2) before any consumer/source phases: its `Public SafeFS must preserve shared SafeJS runtime identity` prerequisite expects `./packages/safe-js/dist/safe-fs.js` from root exports but receives undefined. Root metadata and prior edits were preserved. The fresh maintained ssconvert package test route passed all 5,820 tests in 281 files with no skips.

The full maintained uncached root unit route did not complete. Its shared Vitest phase completed successfully (including 2 skips and 5 TODOs), and safe-bash runner checks passed 558 tests. The complete safe-bash command/contract suite reported 44,142 passes, 0 failures, 831 skips and 2 TODOs across 1,344 discovered files. Unavailable cells and the two compatibility TODOs are not passes.

The subsequent SafeJS phase reproduced one 5000ms timeout at src/modules/namespace-identity-mc-002-validation.test.ts:529, completed object-registry replays. The isolated original case passed in 2041ms; this did not erase the broad failure. Inspection found 240 dummy loop iterations inflating checkpoint history. Only the completed-replay fixture now uses 3 iterations in each loop and expected total 9; the exact substantial original graph and 80-iteration partial-checkpoint fixtures remain intact. Its fresh full-file rerun passed 18/18 tests, with completed object/map replays observed at 504/491ms. These are bounded observations, not performance guarantees. No timeout was increased and no assertion about aliases, host calls or original host data was removed.

After investigating and repairing that timeout, root stopped only the known failed-run SafeJS process tree. The root command ended with status 143. Remaining SafeJS cases, later workspace tasks and the root posttest hook are incomplete, not passes; neither the fixed-file rerun nor prior package tests constitute a completed broad gate. Final repository lint was rerun after the fixture repair and passed. Product solver source and its recorded hashes remained unchanged throughout these gates. No full repository test success is claimed.

Final replay-fixture source SHA-256 is eabadd258c99ed26b5febac015a5295eaab2b8f567c6c631ef596a5bcf2cae9e. Repository lint after that repair completed with 0 errors and 4 warnings across 16,996 configured/linted subjects; root types/contracts and workflow lint passed. Builds preceded this test-only edit; product source was unchanged. Task-owned temporary fixtures, logs, ad hoc invocations and screenshots were reduced into this procedure/results document and purged. Existing source archives, oracle installation/container and other evidence were preserved.

## Scope limits

| Runtime/representation cell | Result |
| --- | --- |
| Node 22.22.2 macOS, injected SDK/virtual I/O, C/UTC | Passed measured deterministic model/validation and publication-refusal cases |
| Linux ARM64 native 1.12.61 oracle, C/UTC | Observed independent validation, integer export and active/order controls |
| Captured GLPK/LPSolve/Nlsolve native registry | Functional in captured profile; numerical execution unmeasured here |
| JS GLPK/LPSolve/Nlsolve/quadratic optimization | Unavailable, explicit parity blockers |
| Excel/ODF spreadsheet optimizer metadata | No verified released importer mapping; unsupported/unmeasured |
| Other locales, browser/workerd and cross-realm runtime matrix | Unverified by this candidate QA |

Native GLPK/LPSolve/Nlsolve are QA-only dependencies. JS algorithms remain explicitly unavailable and valid models refuse publication; optimization, numerical results, limits during execution, reports and scenarios remain blockers. Excel/ODF optimizer metadata has no verified released importer mapping; these cells are unsupported/unmeasured, not passes. Full profile qualification remains incomplete.

Malformed XML warning bytes, localized constraint matching, legacy zero/invalid dimensions, detached/3D/external solver references, native input-cell allocation and target recalculation mutation/namespace ordering remain mismatches or unmeasured. Host/realm authority and runtime variants are covered only where existing shared-engine tests exercise them; no new cross-realm matrix or exhaustive native optional-solver matrix was measured. No local commit, push, remote-main delivery or release occurred. README files were not edited.

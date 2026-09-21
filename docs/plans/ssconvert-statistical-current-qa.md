# Statistical tools current-candidate QA

## Procedure

1. Preserve existing edits, README files and metadata. Do not push or publish.
2. Authenticate the official Gnumeric archive under `out/ssconvert-lifecycle`; inspect released `run_tool_test` inventory independently of GUI tools.
3. Have a different agent inspect all 15 statistical/utility tools, reproduce concrete defects with failing in-memory regressions, and stress cancellation, budgets and independent numerical cases.
4. Build uncached maintained ssconvert and Safe Bash workspace closures. Run ssconvert workspace unit/lint and the Safe Bash ssconvert integration file. Investigate failures without modifying unrelated exports.
5. Execute the original three-case advanced-filter differential in `out/ssconvert-statistical-current/qa.mjs` against the separate Colima oracle. Compare status, stdout and stderr exactly, including ASCII and exact-Unicode negative controls. Inspect a screenshot of actual command output.
6. Bind the final dirty candidate to SHA-256 source/test/profile inputs. Report fresh results separately from the historical receipt and retain all remaining qualifications.

## Results

The archive matches SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. Released source confirms 31 accepted names and explicitly excludes consolidate, random-generator and random-generator-cor.

The first native differential reproduced incorrect Unicode criteria-header folding in the pre-fix build; ASCII and exact-Unicode controls passed. An initial QA invocation selected a generated sheet before analysis execution and used an incomplete native settings environment: all three runs failed admission and emitted native configuration warnings. Those harness failures are not semantic passes. The corrected invocation exports the active generated sheet and supplies memory GSettings/schema configuration.

Safe Bash typecheck failed with exit 2 before compilation: the public SafeFS export is undefined rather than `./packages/safe-js/dist/safe-fs.js`. The guard validates unrelated root metadata; existing exports are preserved. No typecheck pass is claimed.

Different-agent review repaired three advanced-filter defects after failing regressions: ASCII-only header folding, present empty STRING criteria and tolerant numeric field-index truncation. All five fresh native cases match status/stdout/stderr exactly after repair, including independent positive controls. The captured profile's 74 binary/source/library bindings authenticate successfully; active plugins and package versions were not reinventoried. Original deterministic fixtures require no seed.

Final ssconvert uncached unit run: 300 files, 6,164 tests pass, zero failures/skips. A preceding run during independent regression development had one failing new empty-string test (6,163 passes); it is retained as a failing-before-fix run, not a gate pass. The final complete workspace run resolves it. Workspace lint passes source ESLint and source/test TypeScript checks; the modified integration file also passes ESLint. Final ssconvert uncached build passes its four-workspace closure. Safe Bash uncached build passes its 18-workspace closure; the final closure repeat after all repairs is recorded in the receipt.

Safe Bash ssconvert integration: 68 pass, zero failures/skips, including all 31 accepted names, CLI/SDK byte identity, original/checkpoint/replay namespaces and new XML empty-string/header controls. Independent review adds cancellation reason identity, budget rejection and input preservation for every requested tool, plus an unequal-size pooled/Welch numeric case. Its 131 executions include 63 duplicated imported moments tests and 68 targeted executions; this duplication is not additional tool coverage.

The five-case actual-output screenshot was inspected: CSV fields, Unicode headers and warning/message paths are readable and complete. The permanent receipt is `docs/ssconvert/statistical-tests-current-verification.json`; it binds the dirty candidate inputs rather than claiming a sealed commit and preserves original differential XML fixtures/argv/channels for replay after scratch cleanup. Final Safe Bash build repeat passed all 18 workspace builds after the repairs. No commits, README edits, push or publication occurred. Task-owned scratch is purged after receipt reduction.

Historical native coverage and remaining mismatches remain in `docs/ssconvert/statistical-tests-utilities-verification.json` and the original statistical QA records; they do not certify this dirty candidate. Full root gates, browser/workerd, packed consumers, exhaustive workbook styling/exporters and performance qualification remain unverified.

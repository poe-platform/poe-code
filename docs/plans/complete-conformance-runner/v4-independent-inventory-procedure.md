# V4 independent mismatch inventory and final audit procedure

Prepared 2026-09-12 while V4 runs. This is an agent-executed QA procedure, not a runner change or a completed baseline claim. Output belongs under `docs/plans/complete-conformance-runner/baseline-v4`; preserve V3 and incomplete attempts. Do not write code or commit while the cohort is frozen.

## Immutable inputs and observed schema

V4 manifest: `547fad76257b2e6e3d5aae1626ead11434d557f8f3d12b2b613aea238dee41a9`; source SHA `a4476e3fabf1bf5f3c492aa76f38ff0bf3d05e46`; source hash `aa87050d0107c7e5c7ab7beab09ff260c65c7b119fc25d76ac294e9c6565f5b3`. Runtime: Node v22.23.2, ICU 78.2, V8 12.4.254.21-node.56, Darwin arm64. Pinned Test262 revision `419d3e0a2273ba01a3bfcbec423f2801425b8e93`. Required limits remain the manifest's 3000 ms variant/wall timeout and 10000 ms worker startup allowance, unchanged effective budgets and kill-and-replace-without-variant-retry policy.

`manifest.json` supplies `files[]` with file hashes, flags/features/negative metadata and each mode's ID/hash; it also supplies fixture assets, harness hashes and source-file hashes. `batch-schedule.json` supplies disjoint at-most-250-file ranges, command vectors, expected variant counts, log and receipt paths. Each completed JSONL has one header, per-file result rows and one final complete summary. The final maintained aggregate and independent inventory are not yet inputs until qualification produces them.

The previous V3 inventory schema is suitable as a shape reference: manifest/source/runtime/execution, completeness and pending counts, census counts, module/rejection-policy audits, feature/path summaries, checked report hashes, groups and per-variant mismatches. Its **outcomes, diagnostics, counts, examples and passing controls are historical and forbidden as V4 inputs**. Only stable ownership labels/path mappings may inform fresh classification after checking the current fixture and current V4 outcome.

## Independent coverage reconstruction

1. Read V4 manifest bytes and record SHA-256. Independently enumerate filename/mode IDs from `files[]`; reject duplicate files or variant IDs. Recount the manifest census instead of assuming V3 totals. The already observed constant census is 53,876 JS files, 294 fixtures and 102,926 variants; independently explain any disagreement before proceeding. Confirm fixture-asset and harness hashes against pinned corpus when needed; keep `.js` fixtures distinct from non-JS fixture assets.
2. Obtain qualification's exact admitted report allowlist. Do not glob every attempt into aggregation. A report is admitted only after its writer has exited, receipt marks complete, JSONL parses, and its final nonempty record is the sole summary. Hash the entire immutable report. Preserve incomplete/superseded attempts separately with reason and replacement receipt; do not cherry-pick successful variants from them.
3. Compare every header's manifest ID, corpus revision, source SHA/hash, full runtime object and full execution object to V4. Compare header selection, summary selection and manifest range selection as exact ordered lists with unique filenames. Confirm process receipt's command, range, manifest ID, exit and expected variants match its schedule entry.
4. Independently count file entries and each status without importing `report.ts` or invoking runner counting helpers. Check all result file hashes against the manifest. For test rows, require each enumerated mode exactly once, no invented mode and status from passed/failed/unsupported. Compare each reconstructed selection count to both terminal summary and process receipt. A process exit of 1 is expected for a complete nonpassing selection; process success requires every selected variant passed and no file-level errors.
5. Across admitted reports, reject duplicate filenames and filename/mode IDs. Require exact set equality with the manifest. If an execution-error file has no variant results, retain it as a file-level error and explicitly enumerate its unresolved expected variant IDs; do not manufacture test statuses or count them as passes. Metadata errors remain file-level nonpasses with no fabricated variant count. Complete file coverage alone is insufficient for complete observed-variant coverage.
6. Cross-check fresh totals with maintained final aggregate: `passed + failed + unsupported = observed variants`; observed and enumerated variants must agree for the ordinary completed baseline with zero execution errors. For the current known census, all files must reconcile to 294 fixtures plus test files (and any explicitly observed errors). Final runner success is true only when every enumerated selected variant passed, with zero metadata/execution errors. Accounting verification success is separate from semantic runner success.

## Fresh actionable mismatch inventory

Create one mismatch row for every V4 failed or unsupported variant, plus explicit file-level records for any metadata/execution errors. Each variant row carries filename/mode ID, pinned upstream URL, original and variant source hashes, current flags/features/negative metadata, `esid` when available from original YAML, raw V4 status/reason/detail, admitted report name/hash, classification, primary owner and maintained source surface. Preserve unknown metadata and diagnostics rather than forcing a familiar historical bucket. Unless independently reconciled to the fixed published edition or an explicit extension pin, keep `targetDisposition: fixture-to-edition-reconciliation-pending`.

Apply reason-based classification before path-based semantic ownership:

| Fresh observation | Classification / primary owner |
| --- | --- |
| unsupported/module | capability-boundary / qualify-source-modules |
| unsupported/agent, shared-memory or blocking-mode | capability-boundary / qualify-shared-memory |
| unsupported/IsHTMLDDA | capability-boundary / qualify-environment-contract |
| unsupported/gc | capability-boundary / qualify-weak-lifetimes |
| timeout or host budgetExceeded outside harness | budget-or-timeout / qualify-resource-and-timing-behavior |
| harness-error, even if its detail is budgetExceeded | harness-qualification / verify-conformance-oracles; preserve resource cause as secondary diagnostic |
| unhandled-rejection | unqualified-rejection-policy / verify-conformance-oracles; preserve sync/async flag and assertion diagnostic separately |
| host-error/reentry tied by diagnostic/fixture to generator-state guard | guest-generator-state-guard-nonpass / qualify-language-semantics; do not classify unknown reentry by assumption |
| unexpected/missing throw, wrong phase/type, async-failure | semantic-candidate-unvalidated / owning feature; an observation is not a validated ECMAScript defect |
| unknown capability, host error or file-level error | explicit unresolved harness/oracle qualification; no silent fallback to passing or semantic defect |

Path/feature ownership for semantic candidates follows maintained task boundaries: Promise/async ordering → qualify-async-job-order; ArrayBuffer/DataView/TypedArray → qualify-binary-memory; Intl/Date/Temporal localization → qualify-intl-environment-matrix; RegExp → qualify-regexp-semantics-and-cost; WeakRef/FinalizationRegistry → qualify-weak-lifetimes; Object/Proxy invariants → qualify-exotic-object-invariants; Script/eval/generator/parser → qualify-language-semantics; other builtins → qualify-builtins. Preserve specialized module and capability owners above even when fixture paths are under a builtin. Temporal and staging/newer features are not silently reclassified into the published-edition target.

For each group, choose the first actual V4 mismatch in deterministic filename/mode order as the example. A passing neighbor must be an actual V4 passed row, preferably same mode and nearest same-directory feature/control surface. Record neighbor ID, original/variant hashes and admitted report. If no meaningful fresh control exists, record null with a reason; never copy a historical passing neighbor or imply that passing alone validates the failed oracle. Secondary owners may be additive, but every mismatch has exactly one primary task for additive totals.

## Final cross-checks and reporting

Independently reconstruct inventory membership from raw V4 rows and assert exact ID/status/reason/detail/hash equality. Require `mismatches.length = failed + unsupported` when no file-level errors; list file-level records and unresolved variant IDs separately otherwise. Group totals, primary-owner totals and exclusive category totals each sum to variant nonpasses. Feature totals overlap because fixtures may have multiple features: report them as attribution, not an additive denominator, and retain a no-feature bucket. Path rollups must state the prefix depth and whether partitions overlap.

Recompute the module gate from current metadata/results: all enumerated module variants remain explicit nonpasses; nonmodule runtime dynamic-import/defer/source-phase requirements are unqualified; parse-negative cases are counted independently. Recompute rejection policy totals from V4 rows as sync, async and secondary assertion diagnostics; do not reuse V3's 74/50/24 counts. Recompute each reason and timeout/budget diagnostic total.

Write `independent-final-crosscheck.json` with exact manifest/report/inventory/aggregate hashes, checked report count, all census/status totals, missing/duplicate/error counts and zero-or-explicit mismatch findings. Write a concise V4 audit summary linking that receipt and the actionable inventory. If V3 comparison is useful, make a separate explicitly two-cohort delta document keyed by pinned variant IDs; mark source/runtime provenance for both and never label timeout differences as demonstrated repairs. Keep baseline completeness, conservative host-policy nonpasses, semantic candidates and release receipts distinct.

Only after qualification's maintained aggregate and this independent cross-check finish may the main evidence ledger claim current full-corpus baseline completion. None of these steps permits budget changes, variant retries for a better score, silent filtering, unsupported-to-pass promotion or publication claims.

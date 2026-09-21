# Sheet selection and range QA

1. Authenticate Gnumeric 1.12.61 against SHA-256
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Keep primary and dependency sources, logs and native fixtures only in `out`.
   Capture the separate native oracle's dependencies, plugin listings and locale.
2. Execute original small native fixtures for ordered, duplicate and unknown
   selections; active versus first sheet; workbook/sheet/range scopes and split
   rejection; qualified/unqualified ranges, whole axes, quotes, sheet spans,
   named expressions, trailing text and set delimiters. Inspect hidden axes,
   sparse blanks and merged ranges. Check merge's pre-input option ordering.
3. Reproduce validated discrepancies with failing in-memory tests before repairs.
   Use memfs for unit file effects, injected byte capabilities and cancellation.
   Do not spawn native utilities or write host files in unit tests.
4. Implement in the shared command/SDK engine in `packages/ssconvert`. Retain
   workbook ownership, storage/work budgets, namespace and cancellation contracts.
   Export/integration and Git ownership remain with root.
5. After implementation, assign a different agent to stress/fix the package.
   Require failing regressions for independently validated repairs.
6. Run uncached maintained selected workspace builds, package tests and lint,
   plus Safe Bash integration/type checks covering the shared API. Inspect an
   actual virtual command screenshot for affected diagnostics.
7. Reduce coverage, oracle identity and every known mismatch into
   `docs/ssconvert/sheet-selection-and-range-verification.md`. Unmeasured or
   unsupported cases are not passes. Remove only this task's scratch/container
   after reduction. Do not edit README files, push or publish.

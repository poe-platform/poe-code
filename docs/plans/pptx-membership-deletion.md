# Slide membership deletion consistency

Root owns slide-removal.ts, slide-removal.test.ts, command-slide-removal.test.ts,
slide-removal-usage.md and this plan. Preserve all unrelated changes. No pipeline,
README edits, push or release.

Current spec F09/6.4 requires deletion to prune section and custom-show membership
and empty containers automatically. Five original SDK/CLI tests reproduced the
existing unexpected dangling-reference failure. Remove only the membership policy
requirement; existing explicit repair/refusal behavior for other references remains.
A separate original memfs case verifies deletion of every repeated show entry,
surviving repeated entries and stable show IDs through independent XML assertions.

## Verification procedure

1. Run the focused SDK and command removal suites, then maintained package test,
   lint and build closure before committing. Use existing adapter checks after build.
2. Inspect package diffs and unchanged member assertions. No corpus source is needed
   for this policy-only correction; membership feature QA is in the companion plan.
3. Stage only the five owned files and commit the atomic fix on main locally.

## Receipt

Initial focused run: five failures, 45 passes. Removing the membership-only policy
check made the original 50 tests pass; subsequent repeated-entry regression and
maintained checks are recorded below after execution. Other navigation policy
requirements remain tested. No new source-derived code/assets or license copying.

Final receipt: all 51 focused removal tests pass, including repeated-entry cleanup.
Maintained `npm test --workspace=pptx` passes 944 tests in 33 files;
`npm run lint --workspace=pptx` passes ESLint and both TypeScript projects.
`npm run build:workspaces -- --workspace=pptx` passes the selected dependency
closure. The three registered safe-bash pptx files pass 67 tests against rebuilt
exports. Owned adapter ESLint and `git diff --check` pass. No push or release.

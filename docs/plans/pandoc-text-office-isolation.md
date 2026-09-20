# Public Pandoc text import isolation

Scope: retain maintained SDK/plugin exports and private workspace identities;
isolate the original PPTX adapter from the static text conversion import graph.
Preserve agentCommands, historical fixtures and unrelated changes.

1. Reproduce eager presentation-engine inclusion with an original public graph
   test against maintained bundle artifacts.
2. Load the original TypeScript PPTX adapter only when its reader/writer executes;
   check cancellation before and after module admission. No native fallback.
3. Validate both static and optional runtime graphs, SDK consumer types and
   explicit plugin collision/replacement behavior without unit disk mutations.
4. Run `npm run build:workspaces -- --workspace=virtual-bash`, Pandoc package lint
   and tests, `npm run build`, focused public checks, full `npm test` and
   `npm run lint`. Inspect `npm pack --dry-run --ignore-scripts --json` inventory.
5. Execute the public SDK/plugin example from docs/pandoc/public-wiring.md and
   check text imports with ambient fetch denied. Record evidence in docs/pandoc.
   Copy the reachable built declaration closure and root manifest into memfs,
   apply maintained `rewriteWorkspaceDts`, and compile public SDK/plugin imports
   with strict NodeNext checking and no private workspace manifests or symlinks.
6. Commit verified owned files on main, including this plan. Do not push/release.

The original graph assertion failed because the static public graph contained
PPTX sources (docs/pandoc/text-office-isolation-red.log). The existing public
export/type/registration checks passed in that same run. Integration checks
were initially pending; earlier evidence is not a current gate pass.

Selected build closure, Pandoc lint/typecheck and 1,063 unit tests, full build,
58 focused public/bundle tests, repository lint, isolated published types and
manual SDK/plugin/PPTX/runtime/package-inventory QA pass. Auxiliary package lint
reports missing Pandoc/PDF READMEs; README additions require user permission.
The initial full test run reported other-workspace timeouts and was stopped.
The retry after lint completion finished with 24 failed tests in 23 files and
one worker-start error; 129,676 tests passed, 2 skipped. None of its reported
failures is in Pandoc. Subsequent workspace tasks were not certified after the
shared task failed. Neither run is a passing integration test gate. No unrelated tests,
timeout limits, declarations, inventories or historical fixtures are changed.

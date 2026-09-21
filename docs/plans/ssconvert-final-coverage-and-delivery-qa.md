# Final ssconvert coverage and delivery qualification

Run against the authorized live worktree; preserve existing edits. Root owns
integration, exports and Git. An independent agent checks the compiled tool.
Temporary output belongs in an owned directory under out and is removed after
results are recorded. Primary source stays under out; native execution, if
needed, is a separately captured QA oracle and never a unit/product fallback.

1. Read root/scoped AGENTS.md and inspect Git status. Bind Gnumeric 1.12.61
   source to SHA-256 2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12.
   Verify source locator hashes and captured dependency/plugin/locale profiles.
2. Reconcile spec, feature and function registers with actual source and compiled
   consumer tests. Keep name counts, lexical records and semantic case counts
   distinct. Each source obligation requires concrete evidence or an explicit
   open blocker. Do not promote formats/functions from a smoke or mock.
3. Partition register obligations into CLI/parser, formats/versions/records,
   workbook objects/styles, functions/numerics, graphics/printing,
   optimization/analysis, capabilities and service adapters. Report implemented,
   failed, unmeasured and unsupported separately, with the counting unit. Retain
   all numerical discrepancies and optional profile qualification failures.
4. Run npm run build -- --no-cache, fresh maintained domain tests/lint, guarded
   Safe Bash tests and npm test -- --no-cache plus npm run lint. Native/external
   profiles must remain fresh or explicitly unmeasured. Preserve the runner's
   local Git variable clearing and Safe Bash optional-env scoping. Do not bypass
   held-path/inventory checks or use retired release gates. Workflow changes
   require npm run lint:workflows, never workflow unit tests.
5. Have a different agent exercise compiled public exports with original small
   in-memory CSV/XML data, command/SDK byte identity, checkpoint replay, parser
   errors, namespace preservation and cancellation. Run the maintained public
   consumer and usage examples. No native subprocess or disk fixtures in units.
6. For a validated runtime repair, first add a failing regression/differential
   case, then fix only responsible package logic, and repeat appropriate gates.
   For documentation contradictions, correct only measured claims. Do not change
   runtime speculatively, increase timeouts or weaken assertions.
7. Record results in docs/ssconvert/final-coverage-and-delivery.json. Retain failed
   first runs beside rechecks; a scoped recheck does not clear a full gate.
   Finish usage/config/env documentation in usage-draft.md and retain the explicit
   README approval blocker. No README edits under this authorization.
8. Report local changes, any separately authorized local commits, verified
   remote-main delivery and successful release separately. This task permits no
   push/publication. Future explicitly requested delivery uses atomic owned-file
   Conventional Commits on main, manual checks, direct main push and GitHub
   publication monitoring through success.

Complete semantic census closure, full version/record/numeric/rendering matrices,
matching optional profiles and deployed service acceptance remain required even
when the maintained build/unit/consumer checks pass.

# JavaScript optimizer Newton follow-up QA

## Procedure

1. Authenticate the existing source archive under out against the requested SHA-256. Read the released solver manifests, nlsolve Newton scheduling and positive-definite solve, analytic Hessian construction and Newton line search. Retain the captured full and LPSolve-only profile in docs/ssconvert/optimizer-reference-profile.json. No native oracle is a product dependency.
2. Before implementation run the new original in-memory coupled quadratic with MaxIter=1. Require the analytic minimum (3,2), feasible status, an iteration-limit warning, the report objective and unchanged original cells. Use tolerance for floating-point arithmetic; exact binary representations are separately measured.
3. Generate original minimal Gnumeric XML under out/ssconvert-optimizer-newton. Execute the separate Docker context colima ssconvert-statistics-qa oracle with explicit C locale, UTC, prefix library/schema paths. Measure unconstrained/coupled quadratics, maximization, constrained Newton line search and unsupported derivative fallback. Compare command exit status, warning bytes, variables, objective and reports. Do not spawn native tools in unit tests.
4. Assign a different agent numerical and resource/authority stress using independent expectations, including indefinite/singular Hessians, reference chains/cycles, cancellation and allocation budgets. Root retains integration/export/Git ownership.
5. Run fresh solver tests, maintained workspace tests/lint and uncached selected safe-bash build closure. Exercise actual CLI/SDK equivalence, byte I/O, memfs effects and original/checkpoint/replay execution. Record failures/incomplete gates separately. Existing parity gaps remain unverified unless measured by this follow-up.
6. Capture and visually inspect actual built virtual-command output through the generic screenshot command (poe-code has no direct virtual ssconvert entry point). Store evidence only in out and purge task-owned artifacts after recording results. Preserve all prior edits and README files. Do not push/publish.

## Initial evidence

The source archive SHA-256 matches 2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12. The new regression failed before implementation: direction search returned (4.0545654296875,1.3515167236328125) rather than the coupled quadratic optimum (3,2). Released nlsolve attempts analytic positive-definite Newton improvement in the first twenty iterations and every hundred thereafter, before direction search. Its full-step acceptance uses strict improvement and ordinary solver constraints. Only the linear GLPK/LPSolve and nonlinear Nlsolve factories occur in the captured manifests; quadratic metadata has no factory and retains the existing conversion-continuation warning behavior.

## Scope and remaining limits

This follow-up adds second-order differentiation for arithmetic and scalar reference formula graphs, native modified-Cholesky diagonal regularization, bounded pivot solving, Newton line search and compound axis polishing. Unsupported derivative expressions retain direction search. Full native analytic function coverage, goffice conditioning/rounding classification, plugin-specific simplex/presolve/scaling and complete report layout parity remain incomplete. The released tentative-move fields are dormant: no assignment enables a tentative move in the audited source; this is not an active missing search variant. Other runtime/locale/plugin matrix cells remain unverified. The preceding optimizer QA documents describe earlier evidence, not fresh gates for this revision.

## Additional failing regressions and repairs

- Released compound iteration tries the no-progress search and then axis polish before completion. A stationary `A1^2` initially emitted no warning for MaxIter=1 or 2. Fresh native runs confirm warning/status 0 at limits 1/2 and quiet completion/status 0 at limit 3. A failing regression preceded explicit search/polish/completion phases. Private zero routine budget still rejects iteration before arithmetic; command metadata zero still performs its first iteration.
- Independent stress found a premature line-search expansion return and ordinary Cholesky rejection of native regularizable Hessians. Source-backed TDD repairs now preserve repeated expansion and modified-Cholesky correction/permutation indexing. See the independent QA procedure for minimized quartics, closed-form derivatives, exact coupled solutions, singular/indefinite controls and cancellation/budget cases.
- The full solver run caught the established `2*A1` nonnegative-boundary case exceeding workbookWork=10000 during polish. An independent workbookWork=5000 boundary-polish case reproduced it. Known impossible box candidates avoid unnecessary recalculation, with raw objective evaluation retained when needed for native flat-direction accounting. Both regressions pass without raising budgets.
- The actual virtual command initially failed the new constrained case with `ssconvert formula node limit exceeded`: differentiation incorrectly treated the invocation operation count as an AST-node limit. Independent operations=1 and long-formula admission regressions failed before the repair. Formula length is admitted to the numerical work budget before parsing; parser node count follows formula length rather than invocation operation count. The original command binding remains at operations=10.
- One independent assertion mistook legitimate internal negative zero for positive zero. Its expectation was corrected; production zero signs were preserved.

## Fresh native differential execution

The separate Docker context colima oracle ran with LC_ALL=C, TZ=UTC, LD_LIBRARY_PATH=/out/ssconvert-statistics-oracle/prefix/lib and GSETTINGS_SCHEMA_DIR=/out/ssconvert-statistics-oracle/prefix/share/glib-2.0/schemas. Its source/dependency/plugin profile is the existing authenticated optimizer reference profile. Native utilities are absent from product and unit execution.

All three original models start at (0,0), use nonlinear metadata, nonnegative inputs, MaxIter=1 and ProgramR=1:

| Model | Native changed inputs | Native objective | Status/diagnostic |
| --- | --- | --- | --- |
| Minimize `(A1-3)^2+(A1-3)*(A2-2)+(A2-2)^2` | (3,2) | 0 | exit 0, iteration-limit warning |
| Maximize `20-(A1-3)^2-(A2-2)^2` | (3,2) | 20 | exit 0, iteration-limit warning |
| Minimize `(A1-3)^2+(A2-2)^2`, `A1+A2<=2.5` via cell RHS | (1.261706618671816,0.8411377457812107) | 4.3646256038224251 | exit 0, iteration-limit warning |

Against the final built JavaScript engine, compared 32/32/39 native cells respectively, including 27/27/34 program-report cells. No mismatch was found for numeric values at relative tolerance 1e-12, exact strings, sheet names, report formula absence, report bold styles or final focused report name `Solver (1)`. Native stdout is empty and its diagnostic is exactly `Solver reached time or iteration limit` followed by a newline, matching actual virtual CLI output. Numeric binary/serialized equality outside these observations is not claimed; default style records and autofit geometry remain unqualified.

## Final candidate and gates

Baseline Git revision: b97c4938a469ee70e09bd08a0e5fcf7e868ca04c on main, with prior user edits preserved. No local commit was made. Frozen production file SHA-256:

- newton.ts: 2cc4f3eadcb812c7a0120859c316dd808d32a34e55f1515857a366a736bdb850
- nonlinear.ts: 53f5508733c7a736a8318f29e572bbc2e1d78445614188e4ebe69494b274a8e7

Passes after final production edits:

- `npx vitest run packages/ssconvert/src/solver`: 119 tests, twelve files, zero failures/skips.
- `npm test --workspace=@poe-code/ssconvert -- --maxWorkers=1`: 5876 tests, 287 files, zero failures/skips, complete fresh execution (81.90 seconds on this host; not a performance qualification).
- Independent agent's maintained `npm run lint --workspace=@poe-code/ssconvert`: ESLint, source TypeScript and test TypeScript, exit 0 after final fixes.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`: all eighteen selected maintained builds and optional postbuild, exit 0 after final fixes.
- Actual `node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/ssconvert*.test.ts`: 96 passes, zero failures/cancellations/skips/TODOs, complete execution against final built artifacts. The new constrained Newton case checks exact CLI/SDK bytes, limit diagnostic and exit 0, null-prototype workbook values, feasible report/static cells, original/checkpoint/replay and unchanged memfs namespace.
- Repository ESLint, root types/contracts and workflow lint components completed with exit 0 during this work. These preceded the final local parser/box-admission repairs; final changed-scope lint/type verification is the maintained ssconvert lint route above. No post-repair repository-wide lint pass is inferred.
- Actual built virtual-command screenshot captured through `npm run screenshot` and visually inspected: the iteration-limit warning with status 0, original-sheet changed inputs/objective, feasible report and positive constraint slack are readable. Original-sheet export must explicitly select `sheet=Sheet` because reports receive focus; report export uses quoted `sheet='Solver (1)'`.

Failed gate: `npm run typecheck --workspace=@poe-platform/safe-bash` exits 2 at `Public SafeFS must preserve shared SafeJS runtime identity`: root metadata has no `./safe-fs` export, while the guard requires `./packages/safe-js/dist/safe-fs.js`. The guard ran zero builds, zero source-consumer groups and zero runtime executions, and reported cleanup=true. This metadata prerequisite remains unresolved; it is not a source-typecheck pass. Root package metadata and prior build-owner edits were preserved.

Earlier failures are recorded above and were investigated; the complete final package and command runs passed after repair. No timeout occurred in the final runs. No root `npm test` or root `npm run build` broad gate was run; this is a selected workspace implementation/build closure. Browser/workerd/other host/realm, additional locale/plugin profiles, optional native integer sensitivity, all upstream nonlinear families, global-optimum/conditioning/performance matrices and complete solver report geometry remain unverified. Unsupported/unmeasured cases are not passes. Full requested Gnumeric-profile compatibility remains incomplete.

Task-owned temporary fixtures, logs, native outputs and screenshots are purged after reducing evidence here. Authenticated pre-existing source/oracle assets are preserved. README files were not edited. No push, remote-main delivery, publication or release occurred.

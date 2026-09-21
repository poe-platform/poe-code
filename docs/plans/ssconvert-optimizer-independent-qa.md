# Independent JavaScript optimizer QA

## Procedure

Use the actual `simplex`, `solveLinear`, `SolverProgram` and `solveNonlinear` implementations. All fixtures are original in-memory workbook objects or coefficient arrays. Tests do not spawn native tools, write files, query an LLM or use host clocks. The injected elapsed-time fixture and aborted signal exercise invocation-owned capabilities.

Run `npx vitest run packages/ssconvert/src/solver/optimizer-independent-stress.test.ts packages/ssconvert/src/solver/algorithms.test.ts` for targeted fresh verification. Run the maintained workspace lint and root-owned maintained uncached workspace build/test routes before final delivery. Native Gnumeric remains a separate optional differential oracle; this independent pass does not invoke it.

## Verified cases

- Integer-infeasible model whose continuous relaxation is unbounded: integer x fixed at 0.5, free y maximized. The initial implementation incorrectly returned unbounded. The failing regression preceded the repair. Simplex now retains its feasible basis for branching; fractional integer coordinates are branched before an unbounded integer result is accepted. The regression passes after repair.
- Classical four-variable cycling tableau: Bland pivots terminate at objective 1 within 100 pivots.
- Negative free variable fixed at -2 with redundant equality rows: optimal feasible result -2.
- Twenty-seven bounded two-integer-variable objectives/constraints: results match independent exhaustive enumeration, integer solutions and every inequality.
- Distinct integer-feasible unbounded and continuous-infeasible results.
- Zero pivot budget and injected one-second elapsed-time limit return limit, never optimal.
- An already-aborted invocation propagates the original cancellation reason before arithmetic. A second fixture aborts through the injected clock after an iteration decision and verifies cancellation again before tableau arithmetic.
- Rosenbrock curved valley from (-1.2, 1), with nonnegative disabled: convergence without a limit, objective below 1e-6, both changed variables within 0.001 of 1. No nonlinear source repair was necessary.

Ten independent tests and eight concurrent algorithm tests passed together (18 total). The independent test file completed in approximately 0.28 seconds. The first maintained workspace lint attempt failed at a concurrent integration-owner syntax error in `src/engine.test.ts:196`. After the integration owner repaired it, `npm run lint --workspace=@poe-code/ssconvert` completed successfully, including production and test TypeScript checks. Final maintained uncached workspace build/test gates remain the integration owner's responsibility.

## Limits of this evidence

This pass verifies numerical results against mathematical expectations, not native plugin equivalence. It does not qualify plugin-specific pivot choices, scaling, tolerances, report formulas/styles, report names, command diagnostic ordering, namespace effects, exact native warning/exit behavior, optional native plugin variants or sensitivity reports. Poorly scaled coefficients and nonlinear global optima are unmeasured here. Successful small fixtures do not prove general mixed-integer or nonlinear convergence.

Do not count unmeasured cases as passes. No commits, push, publication or README edits are performed by this reviewer.

## Final implementation follow-up

After the integration owner added native-profile sensitivity/report behavior, independently reread `program.ts`, `report.ts`, `sensitivity.ts` and `run.ts`, then exercised the final implementation through a new in-memory test file, `optimizer-report-independent.test.ts`.

Seven further tests verify both reports together, case-insensitive report-name collisions, report-id collisions, original workbook preservation, final active sheet, static report cells, sensitivity heading and missing-value alignment, mathematically feasible sensitivity intervals, sensitivity matrix budget rejection, constructor allocation admission and complete linear-matrix admission before evaluation.

Three concrete repairs followed failing regressions:

1. A native Gnumeric/GLPK minimization oracle run performed by the integration owner confirmed optimum (1,3), first constraint shadow -1 repeated across report rows, and finite constraint limits 2 and 4. The JavaScript report returned +1 before the repair. Report serialization now reverses objective coefficient interval signs for minimization and converts normalized row shadow prices/bounds to their original direction, while retaining the captured native per-constraint sensitivity-index reset.
2. An unconstrained ten-variable `SolverProgram` constructor previously admitted lower/upper/index allocations under a work budget of 20 without charging any solver work. The constructor now charges variable/domain/index admission before allocation.
3. A ten-variable/twenty-constraint linearization under work budget 500 started eight workbook evaluations before rejecting its coefficient matrices. The linearization now admits both column/affine matrices and output row coefficients before the first evaluation. The regression verifies rejection without evaluating a workbook.

The final targeted run passed 27 tests: ten numerical independent tests, seven report/budget independent tests and ten integration-owner algorithm tests. This follow-up did not change numerical algorithms or root-owned `run.ts`. The integration owner must rerun maintained workspace gates after these final source changes; the earlier lint pass qualifies only its then-current state.

Sensitivity for equality constraints remains unqualified: internal normalized equality constraints have two inequality rows while native report indexing uses one original row. Alternate degenerate active bases, scaling/tolerance profiles, full optional-plugin sensitivity behavior and nonlinear global convergence remain unmeasured. The native oracle observation above is a specific captured case, not a claim of general GLPK sensitivity equivalence.

## Final frozen-source review

After the integration owner's additional measured GLPK/LPSolve report and failure-path changes, reran `npx vitest run packages/ssconvert/src/solver` against the final source. All nine solver test files passed, 95 tests total. This includes the existing goal-seek suite, model validation, the 17 independent numerical/report/budget tests and the integration owner's 15 algorithm/profile regressions. No further source repair was needed in this pass.

Reviewed the final GLPK grammar failures, unavailable infeasible sensitivity behavior, raw-zero infeasible program reports, LP iteration-limit exemption and reduced-cost/report masking. An additional primary-source audit rejected the attempted unsigned timeout inference: `max_time_sec` is signed metadata, `gnm_solver_check_timeout` is called by the GUI, and released `ssconvert`/plugins do not call that timeout function or schedule an equivalent metadata timer. The integration owner repaired command orchestration to ignore this GUI time setting while preserving finite work and cancellation bounds. Private numerical routines retain independently injected finite time limits. The earlier 95-test pass preceded that final timeout repair and was rerun below. Maintained workspace/build/integration gate receipts are reported separately by the integration owner.

One final necessary allocation repair followed a failing nonlinear regression. With 100 variables and work budget 2000, the direction search allocated a 10000-element matrix and performed six workbook evaluations before the resource rejection. It now admits the initial/reset direction matrices, per-iteration state vectors and accumulated/update matrices before allocating them. The regression rejects after exactly the one initial feasibility evaluation, before any candidate evaluation.

After this repair and the integration owner's source-backed GUI-time/zero-iteration corrections, `npx vitest run packages/ssconvert/src/solver` passed all nine files and 98 tests. This final solver-only receipt supersedes the earlier 95-test receipt. Independent suites now contain 18 tests; no native subprocess or filesystem write occurs in their unit execution. No further source edits are planned by this reviewer. Exact optional-profile convergence, alternate sensitivity bases and equality-sensitivity indexing remain explicitly unqualified.

## Boundary-polish follow-up

The integration owner's actual virtual-command check identified a nonnegative linear objective inside the nonlinear profile that asymptotically approached zero and exhausted its original work budget. Root added a bounded close-box polish using the shared evaluator, strict objective improvement and ordinary constraint feasibility. Independently reviewed that final change and added five original in-memory regressions: accepting a nearby upper boundary for maximization, preserving an interior minimum instead of snapping to a worse boundary, rejecting an improving snap that violates an ordinary constraint, honoring a zero private-routine iteration budget before polishing and propagating cancellation during evaluation of a zero-boundary candidate. All five passed without any numerical source repair by this reviewer.

The latest complete `npx vitest run packages/ssconvert/src/solver` passed 104 tests across ten files, including the integration owner's new measured GLPK mixed-integer sensitivity failure behavior. Independent suites now contain 23 tests. This receipt supersedes earlier solver-only totals.

The close-box polish is a bounded JavaScript completion step; Gnumeric's full native compound polish/Newton/other search path is not ported or qualified by these fixtures. Exact iteration trajectories, convergence on additional nonlinear families and optional-plugin sensitivity bases remain unmeasured. Feasible output and objective improvement in these fixtures must not be described as full native nonlinear convergence equivalence.

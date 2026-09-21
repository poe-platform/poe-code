# Independent Newton optimizer QA

## Procedure

Use original in-memory workbook fixtures in `packages/ssconvert/src/solver/newton-independent.test.ts`. Do not spawn native programs or write files from unit tests. Execute:

```sh
npx vitest run packages/ssconvert/src/solver/newton-independent.test.ts packages/ssconvert/src/solver/newton.test.ts
npm run lint --workspace=@poe-code/ssconvert
```

Compare the source implementation with the admitted Gnumeric 1.12.61 source under `out/ssconvert-lifecycle/gnumeric-1.12.61`: `src/tools/gnm-solver.c` lines 2302–2444, `plugins/nlsolve/gnm-nlsolve.c` lines 195–268 and `src/mathfunc.c` lines 5714–5867. Primary source remains under out. Root owns separate native differential, command/SDK integration, build and cross-workspace gate evidence.

## Observed failures and fixes

- A quartic overshoot exposed premature return after the first improving phase-one expansion: `A1^2-2*A1+10*A1^4+A2^2` returned A1=0.061360171611325655 at origin. The source repeatedly expands by phi+1 until a far-side bracket or maximum-step boundary. Implemented the full expansion and native endpoint-flat equality termination. The coefficient-100 regression independently brackets the stationary root of `400*x^3+2*x-2` in [0.15,0.18] and checks objective below -0.22. The coefficient-10 native routine intentionally reaches its maximum-step bail with an incumbent near 0.42057; requiring that case's exact stationary optimum would misstate native semantics.
- Root's deeper source audit showed that `gnm_linear_solve_posdef` uses modified Cholesky diagonal regularization and a generic linear solve. Ordinary Cholesky incorrectly rejected singular/indefinite Hessians. A concrete failing regression returned undefined for `A1^2` and `A1^2-A2^2` at [2,2]. Ported the source regularization, including its literal `E[P[i]]` indexing, then bounded pivot Gaussian elimination. Regression now gives [0,2] and [0,4], respectively. The implementation admits two dense matrices and cubic arithmetic against the invocation budget before allocating storage.
- A new maximize pivot test initially expected positive zero; the internal minimization-oriented objective correctly returns negative zero for this arithmetic expression. Corrected the assertion; no product change was made for this test expectation.
- A cancellation fixture initially aborted before program construction; construction correctly observed that abort. Revised it to cancel after construction to specifically verify differentiation observes cancellation.
- Follow-up source audit found missing compound axis polishing. Before implementation, three concrete tests failed because the shared search/polish APIs did not exist. Extracted the actual three-phase search for reuse by Newton and polishing. The native polishing pass searches axes sequentially, uses half-unit steps/max-one at zero and frexp-based `2**(e-10)` steps/max-absolute-coordinate otherwise, with reverse enabled and epsilon zero. It retains the released negative-bracket comparison ordering: polishing `(A1-1.7)^2` from A1=2 retains A1=1.8164893993603601 instead of refining to 1.7. An initial overly tight interval expectation was corrected to preserve this native behavior. Every numerical loop now ticks the shared work budget and cancellation; no arbitrary 220-iteration cutoff replaces source termination.
- The root algorithm boundary case `2*A1` starting at 2 exceeded its established work budget 10000 when polishing at the nonnegative boundary. Reproduced the failure and added an independent boundary-polish regression with budget 5000, which failed before the fix. Skip workbook recalculation for candidates known to violate the derived box. Reevaluate their raw objective when necessary to preserve native phase-zero flat accounting: a flat opposite direction, or a one-direction search. An initial conservative-NaN-only version still failed the independent budget case because a truly flat objective searched to underflow; this was investigated and corrected before the final pass.
- Root's command integration found formula AST admission incorrectly reused the command `operations` limit. An independent sufficient-work context with operations=1 reproduced `formula node limit exceeded` on the coupled quadratic. Admit formula text against the shared workbook-work budget before parsing and use formula length+1 as the syntactic node bound. The coupled Newton step now succeeds at operations=1, while a long arithmetic formula with workbook-work budget 300 rejects before parse through the proper work-limit diagnostic.

## Verified coverage

Final combined focused run: 33 passes (13 independent tests, two root Newton regressions and 18 maintained algorithm cases), zero failures/skips, 289 ms aggregate test time on this loaded host. This is a deterministic semantic gate; the duration is not a performance benchmark. No native/LLM calls or file changes occur inside these tests.

Independent cases cover repeated expansion, stationary-root/value bounds, product/division/percent mixed derivatives and maximize signs, singular/indefinite regularization, exact pivoted coupled solutions in both objective directions, feasibility after reduced steps, unsupported function and nonfinite jet rejection, formula reference chains/cycles, differentiation/polish cancellation reason identity and differentiation/search work-budget admission, sequential zero-coordinate polishing, reverse polishing, flat search and invalid step bounds, established boundary work budgets and command-operation-versus-formula-work admission. The maintained package lint route completed with exit 0 after the final numerical and parser changes (ESLint, source typecheck, test typecheck).

## Remaining unverified cells

This review does not certify generic nonlinear-function derivative coverage: analytic Newton intentionally disables unsupported expression graphs and leaves direction search to the shared nonlinear engine. Native ill-conditioned matrices, goffice generic solver rounding/conditioning classification, three-or-more-dimensional correction permutation effects, randomized stress/performance cohorts and exact native quartic differential remain unmeasured here. Native plugin/report/CLI/SDK/realm/replay/cross-workspace cells belong to root's gates and cannot be inferred from these focused passes. No commits, pushes, publishing or README changes were performed by this reviewer.

Candidate numerical source SHA-256: `2cc4f3eadcb812c7a0120859c316dd808d32a34e55f1515857a366a736bdb850`; independent test SHA-256: `a84af904eb47f6bfe99a991ae02a77de76ebd79245edce11478d352c20367b5c`. Recompute them when evaluating a later candidate. This document certifies only the reviewed source bytes and executed tests.

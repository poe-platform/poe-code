# Independent goal seek stress QA

Execute against the current worktree after the root implementation. Use the
separate Gnumeric 1.12.61 oracle and captured dependency/plugin/locale profile
in docs/ssconvert/statistics-native-profile.json. Primary source is confined to
out; its archive SHA-256 is
2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12.

Procedure and measured outcomes, September 21, 2026:

1. Create an original in-memory manual workbook with `=B1*2`, initial B1=1,
   target C1=8, unrelated cached RAND and cached dependent `=B1*3`. Before the
   repair, the regression threw capability-denied by evaluating unrelated RAND.
   After the repair, B1=4, unrelated RAND retains its original cache and the
   dependent retains value 3 with formulaDirty=true. Source goal-seek.c evaluates
   only ycell during each trial and queues xcell dependents.
2. Solve `=B1^2` from 1 toward 2 with workbookWork=100. Before the repair, each
   trial reset evaluator work accounting and completed. After the repair, the
   same regression throws resource-limit. Cancellation is checked before
   mutation and in cumulative evaluator ticks. Random fallback requires the
   injected capability; no ambient Math.random remains.
3. Create original CSV rows `=B1^3,0.1,2,-10,10`,
   `=EXP(B2),0,3,-10,10`, `=(B3-1)^4,2,0,-10,10`,
   and `=SIN(B4),3,0,2,4` in out. Run native with repeated A1:E1 through A4:E4,
   exporting Gnumeric XML. Native exits 0. Input roots are respectively
   1.2599210498948732, 1.0986122886681096, 1.0000000003259071,
   and 3.141592653589794. JavaScript matches these exact binary doubles.
   The cubic JavaScript fallback uses explicitly injected random.next()=.75;
   native random stream identity is not claimed. The quartic is manual QA only
   to avoid a lengthy unit iteration loop. EXP and SIN remain small unit cases.
4. Exercise raw target strings with numeric suffixes, boolean targets, error
   targets and cancellation entirely in memory. Tests assert raw numeric
   prefix/boolean/error coercion and early cancellation. Unit tests neither
   spawn native processes nor write fixture files.
5. Run maintained scoped build/test/lint from the root owner's final candidate.
   The independent focused Vitest regression runs are development evidence;
   they do not replace those maintained gates or root integration checks.
   Independent maintained `npm run lint --workspace=@poe-code/ssconvert` exited 0.
6. Preserve the existing advanced-distribution tail assertion when a root full
   gate reveals a timeout. The narrowed unchanged R.QTUKEY(-1000,3,10,1,TRUE,TRUE)
   assertion took 3516 ms; the root observed a greater-than-5000-ms timeout.
   A CPU profile identified 486 ms in tsx function naming from recreating FMA's
   binary64 component helper on every arithmetic call. Hoist the unchanged helper
   without changing rounding, arithmetic order, scratch ownership or assertions.
   The subsequent arithmetic plus independent-statistics run passed 63/63; the
   same Tukey assertion took 1941 ms. Its expected value remains
   7.186959238596909e-108 with the original relative tolerance. These cohost-loaded
   timings establish the targeted improvement, not a general performance guarantee.

Remaining limitations and unmeasured cases:

- Native random_normal retains a static saved Box-Muller value between ranges
  (gnm-random.c:416). GoalSeekState now exposes that saved variate for the root
  integration owner to retain between ranges within one conversion invocation.
  Cross-invocation process-global state is intentionally not shared across realms;
  stochastic normal-trawl differential stream equivalence is not qualified here.
- Native process-seeded random generation and exact seed/stream replay are not
  matched; explicit injected randomness preserves host/realm capability policy.
- The target evaluator still constructs and parses the workbook dependency graph
  for every trial. Unrelated unsupported formula syntax can therefore reject
  a workbook before target evaluation; that case is not measured here.
- Locales outside the captured C profile, NaN/infinity bounds, circular target dependencies, array-input cells and
  exhaustive numeric convergence are not verified by this independent cohort.
- An initial custom XML reconstruction exited 1 without an output file; it was
  an oracle-fixture failure, not a product failure or a pass. Original CSV input
  successfully measured the four difficult roots. GOConf startup noise under
  the captured profile is retained as oracle baseline noise, not suppressed
  or attributed to goal seek.

Root owns export/integration/Git and final maintained validation. No README,
push, publication or native product dependency was introduced.

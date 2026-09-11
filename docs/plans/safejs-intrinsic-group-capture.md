# Intrinsic retention group capture experiment

## Evidence and scope

The camera profile attributes material work to intrinsic retention capture.
The isolated regression `intrinsic-retention-group-cache.test.ts` fails on the
existing implementation: repeated captures allocate distinct arrays with identical
contents (`b185e0`). This demonstrates allocation, not a semantic defect or a
proven end-to-end speedup.

Experiment only in `/tmp/safejs-new-promise-capability.KGfWqD` while the main
package gate is running. Keep the separate property-key budget fix independent.

## Qualification

- Measure complete camera fixtures with original budgets, native comparisons and
  recorded results before changing the isolated implementation.
- Attempt reuse only for groups whose tables are all revision-tracked. Invalidate
  property/prototype writes and initialization changes; never cache measured byte
  totals or omit nested mutations. Untracked tables retain their existing scan.
- Check mutation ordering, symbols, accessors, prototype changes, baseline reset,
  late group registration, and nested values with focused tests.
- Compare repeated baseline/candidate CPU measurements. Reject the experiment if
  it does not provide repeatable end-to-end improvement.
- Do not modify main source or tests while its full gate is live. No release or
  push while the release hold remains.

## Initial measurements

The six baseline fixture CPU times (milliseconds) were 3192.350, 2809.367,
2206.740, 2939.039, 2726.242, and 2296.518. All native and recorded comparisons
passed (session 61444, terminal b4ed17).

The isolated candidate caches a group's captured iterable only when all tables
are tracked and a conservative global property/prototype revision is unchanged.
Initialization resets invalidate the revision; repeated registration replaces
the group's callback. Nested data remains measured on every use. Untracked
groups still scan. The original six-file accounting selection passed 50 tests;
adding baseline/prototype, late-registration and callback-order controls gives
53 passing tests (269abe).

Candidate CPU times were 3105.673, 2574.393, 2141.291, 2759.418, 2655.593,
and 2218.786 (session 84689, terminal 5c3c3f). Every result again matched native
and recorded data. Total CPU decreased from 16170.256 to 15455.154 ms (4.42%).
This first comparison is not enough to establish repeatability, and competing
processes make wall-clock comparisons especially weak.

After both candidate qualifiers ended, only this experiment's isolated
object-model changes were restored to the saved baseline for another six-run
measurement, session 32133. The candidate source is saved in orchestration
storage as `groupCandidateSource`; baseline is `groupBaselineSource`. Main
remains unchanged at 3f16a34e8 under full package gate 40305. The key-budget
candidate is independent and remains present in the isolated copy.

The second baseline finished successfully (32133, terminal 8d5b4c): CPU times
3634.708, 3136.762, 2470.988, 3117.753, 2783.194, 2344.063 ms, with all six
native/recorded assertions passing. It ran under visibly heavier contention
(first fixture wall time 5886.638 ms). The saved candidate was then restored
for its second measurement. Neither benchmark changes the maintained camera
test deadline or fixture coverage.

The repeated candidate run also passed all six fixture comparisons (77363,
terminal 0d8e86): CPU 2988.498, 2641.550, 2040.724, 2743.141, 2460.007,
2088.362 ms. The second total comparison is 17487.468 baseline versus
14962.282 candidate (14.44%); the different contention makes the magnitude
uncertain. Both comparisons favor the candidate, but neither proves absence
of CI deadlines. A broader fourteen-file retention/snapshot/camera selection
is running as 57807, report `/tmp/safejs-group-capture-qualification.json`.
Scoped lint and TypeScript are running as 98369. Main is still untouched.

The broader selection completed with all 136 tests in fourteen files passing
(57807, terminal 97edf9), including all eleven maintained camera cases. Their
eight sandbox batch durations were 2838.583, 2552.572, 2515.581, 3117.301,
3188.916, 2299.563, 3172.086, 3119.112 ms (report inspected as e215e2).
The maximum is 3.19 seconds with the unchanged five-second deadline. This is
one successful candidate run, not proof that intermittent failures are gone.
Scoped eslint followed by TypeScript also passed (98369, terminal b72da2).
The candidate is ready for main integration and maintained-build qualification
after the current main full gate ends; it is not committed or delivered.

Main gate 40305 has ended: thirteen failures (twelve locale, one Promise symbol),
28,846 passes and 47 skips. All camera tests passed with maximum sandbox batch
4.02 seconds, but no reliability conclusion follows from one pass. The separate
property-key fix is committed as d37226c1b. Main's four-case capture regression
then reproduced the expected allocation failure with three controls passing
(97765, terminal aad141). Only after that result was the reviewed object-model
optimization copied into main. The nineteen-file main selection writes
`/tmp/safejs-group-capture-main-qualification.json`; scoped lint and the maintained
build closure run separately. No commit, push or release of this optimization yet.

The main nineteen-file selection passed all 185 tests (75317, terminal 541759),
including maintained camera, intrinsic snapshot, callback-order and accounting
coverage. Scoped lint passed and the maintained build is running as 33010.
This qualifies the selected behavior on main, not full-package reliability.

The main camera sandbox durations were 2546.446, 2749.666, 2764.239, 3388.336,
3463.498, 2108.845, 2776.912, and 4581.845 ms (e5bfc2). In particular, the
4.58-second maximum remains close to the five-second deadline. The isolated
CPU comparisons support reduced work, but neither the full-run baseline nor
this main selection establishes elimination of intermittent timeouts.
The maintained build passed all 23 dependency builds and five fresh import
checks (33010, terminal 956808). The atomic optimization is locally qualified;
full-package verification after both new repairs remains outstanding.

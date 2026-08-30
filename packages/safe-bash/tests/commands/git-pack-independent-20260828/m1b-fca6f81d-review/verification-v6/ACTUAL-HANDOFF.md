# Remaining33: phase-arithmetic harness HOLD

Overall **FAIL/HOLD**, not product failure or packed acceptance. One actual
continuation ran; no retry or post-stop source change. All owned processes
retired and the guarded temporary root was removed.

## Counts and actual observations

- Fully verified cases:0; final unfulfilled33.
- Executed body: T01-M, raw PASS with3/3 assertions; administrative verification
  did not complete, so this is not credited as a fully verified cohort pass.
-32 bodies never started: eight negative type calls and24 loaded controls.
- All three S01 pristine/reverted/restored controls remain UNRUN.
-12/12 authentication controls passed.24/24 prior synthetic phase controls
  passed, separately; they did not prove real-timer or offset-roundtrip behavior.

T01-M actually compiled through TypeScript5.9.3 API with zero diagnostics,
179 admitted source files, zero denied host operations, matched/completed
result and before/after compiler-host guards. Compiler and worker exited0;
the actor reported cleanup complete/no escape. Its BODY phase recorded PASS.
Strict Darwin/UID501 CF metadata admission remained unchanged. No negative
type diagnostics, loaded mutations or restoration behavior were exercised.

## Exact independent stop

The new producer translated absolute floating-point deadlines into relative
offsets separately. The outer correctly rejected the resulting strict cap
inequality with `PHASE_START_BOUND`:

    VERIFY startedOffsetMs  = 134479.474417
    capMs                  = 120000
    reported deadline      = 254479.47441700002
    startedOffsetMs + capMs = 254479.474417
    excess                 = 2.9103830456733704e-11 ms

This is a review-harness binary64 recomposition defect, not expiration of the
120s verification allowance. The captured cap inequality alone is false;
other parent-receive timestamp conjuncts were not independently captured.
`OUTER_CANCEL` and `RETIREMENT_BARRIER` are consequent coordinator errors,
not evidence of a leaked process. All known PIDs were already retired.

The existing synthetic helper tests use zero-origin state and missed this
actual translated-offset roundtrip. Their original24 PASS records remain
unchanged. report/COUNTEREXAMPLE.json binds the actual message and arithmetic;
no new test/product execution was used to derive it.

Minimal next repair proposal, not implemented: construct the start/deadline
once in canonical relative monotonic coordinates, then derive the absolute
supervisor deadline from the same values. Add versioned fractional-origin
producer-to-outer roundtrip controls. Do not add epsilon, widen caps, relax
hashes/guards, rewrite this result or automatically retry. A new actual GO is
required after a corrected source/control seal.

## Source, package and timing

Source69b5afa5635629dd2a75b113376c9a9401aae81f; preseal
6ac4f47cfb3ca35b14c80699b4ee1f87d2cf25d0; activation
604de4ba244dabcc7607e4337ec5cfa52eda5967. The defective review helper SHA256 is
8ef2086f1ee22b92777d48e4aec464dc5b702fac0b21a66aeddaaadb9a49ea1d.

Product candidate fca6f81d2d96db2bbceabf3247cd57ffe240bde6 and derived source
23074ef0c443ca618c4f26204b5f3d2274b86895 remain unchanged.282 selected inputs/
347 stored objects authenticated. Full910 pack SHA256:
cc0e75c2d0d12f713f0458e608ddeae157cf3432b4e0b48277a329a98115aa1a.
Independent strict build matched908 emitted files; offline install and
physical move succeeded. Only the moved-package T01 body executed; source
rehydration/build is not an additional semantic pass/layout cohort. Public
root Git imports0; no native Git oracle, private engine or network.

Fresh source preauthorization checked59 selected entries/62 stored blobs/
11 origins,515 retained and26 new capture rows. The route SHA256 is
fd8b14c0f719d82464b6668cc21dfd41f3e9a55df56d3d200479fd8d9fc4fc8c;
fresh origin206635759279250. BODY offsets124287.599750–134475.558750ms;
VERIFY admission was rejected immediately, not after its120s cap.

Runtime7 registered processes including outer, peak4, outstanding0. Source
preauthorization13 programs, synthetic controller1, route1 and cleanup1 are
separate from runtime; other tool envelopes stay in the40-helper reservation.
Runtime capture8016873 bytes; logical work peak399008890, not RSS. Cleanup
finished197363.21125ms from the fresh origin, inside120min.84 retained
raw/control/package files totaling3802148 bytes were moved with exact
identities; full remaining membership was checked before removal. All70
selected source/control identities rechecked unchanged after cleanup.

## Preserved qualifications

8827ae25 stays27PASS/0caseFAIL/33UNRUN,211 assertions/12auth and deadline HOLD.
53eb5a53 stays214PASS/26FAIL/34unfulfilled, including32 mechanical/18 private
S01 observations. No sums or rescoring of those cohorts, and no replay of
their214 or27 completed calls. S02 remains SOURCE_CONCERN_UNRUN; H09/native
codec retirement/private-writer qualifications remain. No mutation sensitivity,
full packed readiness, public integration or overall Git parity claim.

report/SUMMARY.json binds exact raw result/type/phase/cleanup hashes;
report/OUTCOMES.json distinguishes the raw passing body from33 unfulfilled
verification obligations. Raw captures and their actual modes are preserved.

# Released bounded execution schedule

This supplements, and never overwrites, the static `PLAN.md` and `frozen/`.
Root released execution and the narrow outer wrapper watchdog on August 27,
2026. Shared helpers, product, root types and `review/` remain unowned.

Before editing canonical tests: archive the closure marker and current hashes;
run the original jq canonical file once, original streaming wrapper once, and
one instrumented native original-25ms plus prefix/readiness experiment. No
forced host load and no retries until green. A missing original intermittent
failure is reported as not reproduced.

After implementation: one serial jq/wrapper pair, then exactly three rounds of
one jq child plus one streaming-wrapper child concurrently. Maximum four live
test/native descendants, achieved by disabling test process isolation only in
the owned streaming wrapper. No CPU-load producers or pathological patterns.
Canonical jq remains 15 cases / 330 triples; streaming remains six assertions.

Native readiness must mean observed `foo\n` before writing NUL, not a spawn,
write callback, pause or inferred read syscall. If default pipe buffering
precludes that observation, retain its failed experiment and explicitly label
any line-buffered native profile adaptation; never call it the original profile.
The virtual command arguments remain unchanged. Whole-write native profile and
all exact output assertions remain unchanged.

Negative controls, once each with short separately labeled budgets: suppress
native readiness observation, withhold suffix delivery, stall child completion,
and suppress cleanup acknowledgement. Use real native children, await their
actual close even on failure, and retain every failed attempt. Also run a jq
execution watchdog stall control. All child processes use strict unhandled
rejections when Node, bounded captures and exact-handle cleanup; an unrelated
owned sentinel must remain alive until explicitly retired by its own handle.

Scoped TypeScript checking only; report imported product/type failures without
editing them. Source snapshots before/after disclose concurrent changes. No
fullgate rerun, runtime dependency, regex risk allocation or acceptance claim.

## Bounded R1 correction check (after the one schedule)

The schedule passed but independent provisional static R1 identified that a
missing close observation could outlive its cleanup deadline. Preserve attempt
one source and all results. Correct only lifecycle supervision/timer evidence;
run exactly one final canonical streaming wrapper, one negative-control cohort
including missing-close observation, and one scoped typecheck. No second stress
schedule or additional jq breadth. Freeze the final source separately: the
three concurrent rounds are evidence for attempt one, not a final-patch stress
pass. The independent reviewer will exercise the frozen correction.

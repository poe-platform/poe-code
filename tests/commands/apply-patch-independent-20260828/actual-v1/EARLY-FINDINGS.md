# Early independent source findings

Candidate: `58be2d6c5706f3e90f01d48e695ecfd9daa52669`; inspection began only after
metadata transition commit `7561d077`. No candidate build/import/execution yet.

## F01 — fixed-only profile differs from the authored module API

Frozen independent `matrix/FINDINGS-v1.md` explicitly says fixed private ceilings
and no public options/limits supersede the proposed configurable signatures.
`matrix/POLICY-v1.json` also rejects lowered public caps as boundary evidence.
The current user says no new public limits/options. Nevertheless candidate
`src/commands/apply-patch/index.ts` exports `ApplyPatchCommandsOptions` and
`ApplyPatchLimits`; all three exported factories accept options. Candidate
`options.ts` lines 17–19 expose `limits?: Partial<ApplyPatchLimits>`; lines 40–53
apply supplied reductions. The author metadata explicitly admits this design.

This is a SOURCE finding, not a runtime failure or a root-export claim. The root
package intentionally does not export this module. Its internal factory/type API
still differs from the fixed-only independently frozen profile. No review may
quietly treat lower-cap probes as fixed-ceiling boundary passes. Root must retain
this discrepancy when considering final integration; the reviewer will not edit
the candidate or reinterpret the frozen expectation. No root GO renewal is needed
to record the finding or finish otherwise authorized bounded investigation.

## F02 — cooperative yield interval requires qualification

Candidate `apply.ts` charges an entire input/read chunk and copies it before its
next checkpoint. `matcher.ts` encodes an entire line before its next checkpoint.
`Work.checkpoint` in `shared.ts` advances its threshold to current units +4096,
not the next crossed 4096 boundary. Thus source admits a single multi-MiB bulk
charge/copy between checkpoints. This does not establish the frozen <=4096-unit
yield interval. Logical caps are not RSS or hard preemption guarantees. This is
source-accounting evidence only; a concrete timing/abort observation, if run,
must not be mislabeled an exact private-counter observation.

All 32 originals, 80 independent rows, 14 limits, installed/moved/type routes,
actual mutants and semantic controls currently remain NOT_RUN. Author results
are not counted as independent passes.

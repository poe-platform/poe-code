---
severity: low
impact: none
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/spawn.ts:527-535 parseSpawnMode: empty string is not undefined and fails isSpawnMode, so it throws ValidationError 'Invalid --mode \"\". Expected yolo, auto, edit, or read.'"
comment: "Positive pattern; near-duplicate of ux-spawn-invalid-mode-validation-good.md (empty versus bogus value, same message). Consolidate. Its contrast is the actionable half and the sharpest statement of the empty-flag inconsistency: --mode \"\" is rejected while --model \"\" is accepted, in the same command. Route to ux-empty-model-flag-behavior-inconsistent.md as the in-product precedent."
---

# UX: spawn --mode "" validation is good (positive)

## Summary

spawn --mode "": Invalid --mode "". Expected yolo, auto, edit, or read — clear ValidationError.

## Evidence

Invalid --mode "". Expected yolo, auto, edit, or read.

## Why it matters

Positive empty mode rejection (contrast empty model accepted).

## Suggested direction

Keep; apply to empty --model on configure.

## Severity

Low

## Area

Spawn / positive pattern

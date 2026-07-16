---
severity: low
impact: none
comment: "Positive pattern, and a useful counterweight to ux-configure-cursor-model-flag-silent-noop.md: spawn cursor honours an explicit --model while configure cursor's dry-run shows no sign of it, suggesting the flag works and the dry-run is what fails to render it. That narrows the cursor ambiguity - worth linking there."
reproduced: n
recommendation: no-fix
evidence: "Positive note, no defect: packages/agent-spawn/src/configs/cursor.ts:9-16 declares modelFlag --model with prefix strip plus dot-to-dash transform, and packages/agent-spawn/src/spawn.ts:139-145 applies it, so anthropic/claude-haiku-4.5 becomes --model claude-haiku-4-5 as documented."
---

# UX: spawn cursor with explicit model works (positive)

## Summary

spawn cursor "say only: ok" --mode read --model anthropic/claude-haiku-4.5 succeeds.

## Evidence

spawn cursor … → ✓ agent: ok

## Why it matters

Positive cursor spawn path with model override.

## Suggested direction

Keep; configure cursor dry-run should show model.

## Severity

Low

## Area

Spawn / positive pattern

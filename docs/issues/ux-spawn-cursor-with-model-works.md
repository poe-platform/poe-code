---
severity: low
impact: none
comment: "Positive pattern, and a useful counterweight to ux-configure-cursor-model-flag-silent-noop.md: spawn cursor honours an explicit --model while configure cursor's dry-run shows no sign of it, suggesting the flag works and the dry-run is what fails to render it. That narrows the cursor ambiguity - worth linking there."
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

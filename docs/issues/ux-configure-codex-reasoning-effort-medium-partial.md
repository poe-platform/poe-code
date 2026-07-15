---
severity: medium
impact: correctness
comment: "Genuinely distinct from the flood cluster despite sharing its noise, and worth keeping: mixed model_reasoning_effort values (high and medium) across profile blocks in a single dry-run suggests --reasoning-effort lands on some profiles but not others - a different defect from the claude 'always ignored' bug. It is unproven though, because the flood makes the output unreadable. Blocked on the intentional-only diff; re-check immediately after."
---

# UX: configure codex --reasoning-effort medium appears in some profiles only

## Summary

configure codex --reasoning-effort medium dry-run shows mixed model_reasoning_effort high and medium across profiles — flag application inconsistent across dumped profiles; full config dump noise.

## Evidence

dry-run includes both model_reasoning_effort = "high" and "medium" in different profile blocks.

## Why it matters

Unclear if --reasoning-effort applied to active profile.

## Suggested direction

Intentional-only diff; show active profile effort clearly.

## Severity

Medium

## Area

Configure / codex

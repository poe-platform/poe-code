---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/models.ts:449-478 parameters view renders Parameter/Type/Default/Values columns via formatParameterValues (enum lists); provider filter at src/cli/commands/models.ts:372; test asserts output_effort enum 'max, high, medium, low, none' at src/cli/commands/models-command.test.ts:1187-1189 - positive note, no defect"
comment: "The most consequential positive in the models set: the parameters view already exposes each model's output_effort enum (max, xhigh, high, medium, low, none), which is exactly the data the effort cluster needs - so ux-effort-xhigh-valid-for-opus-not-sonnet.md and ux-configure-reasoning-effort-still-ignored-always-high.md can validate --reasoning-effort against the catalog rather than a hard-coded list. Its own suggestion says so. Keep and link; this turns model-aware effort defaults from a design problem into plumbing."
---

# UX: models --view parameters with provider filter is useful (positive)

## Summary

parameters view for anthropic shows output_effort enums including xhigh — useful for configuring reasoning-effort (which currently ignores values).

## Evidence

models --view parameters --provider anthropic shows output_effort values max, xhigh, high, medium, low, none.

## Why it matters

Positive discovery UI; wire to configure validation.

## Suggested direction

Keep; use enums to validate --reasoning-effort.

## Severity

Low

## Area

Models / positive pattern

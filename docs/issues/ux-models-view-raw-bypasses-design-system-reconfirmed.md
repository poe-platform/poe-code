---
severity: low
impact: none
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/models.ts:316 rawView flag skips logger.intro (line 319) and spinner; line 440 writeYaml(filtered.map(toRawModel)) emits bare YAML to stdout - intentional script escape hatch"
comment: "Third filing of the raw-view framing observation, and the one that resolves it correctly: keep raw bare for scripts and document the contract. Keep as the survivor of the trio and close the question rather than reframing raw output."
---

# UX: models --view raw still bare YAML (reconfirmed)

## Summary

models --view raw --search haiku prints bare YAML without design-system panel — reconfirm raw view escape hatch.

## Evidence

models --view raw → bare YAML model dump.

## Why it matters

Reconfirm design-system gap for raw view.

## Suggested direction

Keep raw for scripts; document; optional --json.

## Severity

Low

## Area

Models

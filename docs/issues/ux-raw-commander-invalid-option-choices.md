---
severity: medium
impact: polish
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- models --view nope prints raw 'error: option --view <name> argument nope is invalid. Allowed choices are capabilities, pricing, parameters, raw.' unstyled; src/cli/bootstrap.ts:48 passes exitOverride false so Commander writes its own stderr instead of design-system log.error; choices at src/cli/commands/models.ts:278"
comment: "Keep as the umbrella for the raw-Commander invalid-choice family (models --view, hooks --scope/--strategy each file an instance). Contentless but correct, and the important nuance from its instances: Commander's message content is actually good - it lists the allowed choices - so this is purely a skin inconsistency, which makes it cheap and also lower priority than the silent-empty filters where the content is missing entirely."
---

# UX: Invalid choices raw Commander

## Summary

--view nope raw.

## Evidence

models --view.

## Why it matters

Mixed skins.

## Suggested direction

Design-system.

## Severity

Medium

## Area

Errors

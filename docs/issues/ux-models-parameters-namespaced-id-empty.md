---
severity: high
impact: usability
comment: "Duplicate within the namespaced-id cluster (parameters view); retire into ux-models-exact-id-filter-rejects-namespaced-ids.md. Coverage only."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/models.ts:378-383 filters with m.id.toLowerCase() === term, no owned_by/namespace prefix handling, so 'anthropic/claude-sonnet-4.6' matches nothing; filter runs before view selection so parameters view is not a distinct defect"
---

# UX: models --view parameters --model anthropic/… returns empty

## Summary

models --view parameters --model claude-sonnet-4.6 works; --model anthropic/claude-sonnet-4.6 → 0/341 empty — namespaced id fails on parameters view (same class as raw view).

## Evidence

```bash
$ poe-code models --view parameters --model claude-sonnet-4.6
●  1/341 — output_effort enum…
$ poe-code models --view parameters --model anthropic/claude-sonnet-4.6
●  0/341 No models match
```

## Why it matters

Namespaced ids fail inconsistently across models views.

## Suggested direction

Accept namespaced ids everywhere for --model.

## Severity

**High**

## Area

Models

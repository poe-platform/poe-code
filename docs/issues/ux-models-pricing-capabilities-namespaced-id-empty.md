---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/models.ts:378-381 applies --model as m.id.toLowerCase() === term (bare id only) in the shared filter block before the view switch, so pricing/capabilities are affected; rows display namespaced ids via `${model.owned_by.toLowerCase()}/${model.id}` at models.ts:492. Real defect but duplicate: ux-models-exact-id-filter-rejects-namespaced-ids.md is canonical (reproduced=y, recommendation=fix) and states it absorbs the capabilities/pricing/parameters/raw reconfirms."
comment: "Duplicate within the namespaced-id cluster (pricing and capabilities views); retire into ux-models-exact-id-filter-rejects-namespaced-ids.md. Its suggested implementation is the most concrete in the cluster and should survive: strip the provider prefix when matching, which accepts both forms without changing the display id."
---

# UX: models pricing/capabilities empty for namespaced anthropic/ ids

## Summary

models --view pricing|capabilities --model anthropic/claude-haiku-4.5 → 0/341; bare claude-haiku-4.5 works. Same namespaced-id footgun as raw/parameters views.

## Evidence

```bash
$ poe-code models --view pricing --model anthropic/claude-haiku-4.5
●  0/341 No models match
$ poe-code models --view pricing --model claude-haiku-4.5
●  1/341 anthropic/claude-haiku-4.5 pricing table
```

## Why it matters

Users paste full catalog ids (namespaced) used everywhere else and get empty results.

## Suggested direction

Accept namespaced ids on all --model filters; strip provider prefix when matching id.

## Severity

**High**

## Area

Models

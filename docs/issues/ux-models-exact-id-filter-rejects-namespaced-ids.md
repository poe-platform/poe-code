---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/models.ts:378-381 filters with m.id.toLowerCase() === term (bare id only), while rows render theme.accent(`${model.owned_by.toLowerCase()}/${model.id}`) at models.ts:492 and 522; zero-match path at models.ts:433 prints 'No models match the given filters.' with no --search hint."
comment: "Keep as canonical for the namespaced-id filter gap and correctly High: the product prints ids as anthropic/claude-opus-4.7, configure accepts that form, and models --model rejects it with a bare 0/341 - so users copy an id from the tool's own output and get an empty result that looks like the model does not exist. That copy-from-our-own-output path is what makes it worse than ordinary strictness. Absorbs the capabilities/pricing/parameters/raw reconfirms. Its 'suggest --search on zero matches' is the cheapest mitigation."
---

# UX: models --model requires bare id; namespaced catalog ids return zero

## Summary

models --model anthropic/claude-opus-4.7 returns 0/341 while --model claude-opus-4.7 and --search opus-4.7 find the model. Users copy namespaced ids from the models table and get empty results.

## Evidence

```bash
$ poe-code models --model anthropic/claude-opus-4.7
●  0/341 models
$ poe-code models --model claude-opus-4.7
●  1/341 models
$ poe-code models --search opus-4.7
●  1/341 models — anthropic/claude-opus-4.7
```

## Why it matters

Exact filter unusable with the id format the product displays and configure accepts.

## Suggested direction

Accept namespaced or bare ids in --model; document exact-match form; suggest --search on zero matches.

## Severity

**High**

## Area

Models

---
severity: high
impact: usability
comment: "Duplicate of ux-models-exact-id-filter-rejects-namespaced-ids.md; retire into it. Its distinct detail is worth carrying: help says 'exact model id' and its examples only ever use bare ids, so the documentation quietly encodes the limitation instead of resolving it - which is why users never learn the rule until a filter returns zero."
---

# UX: models --model rejects namespaced ids (anthropic/… → 0 hits)

## Summary

models --model anthropic/claude-haiku-4.5 → 0/341; models --model claude-haiku-4.5 → 1 hit. Help says exact model id; examples use un-namespaced ids only — namespaced ids used everywhere else fail here.

## Evidence

```bash
$ poe-code models --model anthropic/claude-haiku-4.5
●  0/341 models
$ poe-code models --model claude-haiku-4.5
●  1/341 models
```

## Why it matters

Inconsistent model id language across commands.

## Suggested direction

Accept namespaced and bare ids; document both.

## Severity

**High**

## Area

Models

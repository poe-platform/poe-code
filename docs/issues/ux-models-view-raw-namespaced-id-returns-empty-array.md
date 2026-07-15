---
severity: high
impact: usability
comment: "The namespaced-id defect at its worst and worth keeping distinct from ux-models-exact-id-filter-rejects-namespaced-ids.md: on the raw view the failure surfaces as a bare '[]' with no message at all, so a script consuming raw output receives a valid empty result rather than an error. Silent empty is bad in a table and dangerous in a machine path. Its second ask matters as much as the first: even when nothing matches, raw should say so rather than emit []."
---

# UX: models --view raw --model anthropic/… returns empty array

## Summary

models --view raw --model claude-haiku-4.5 dumps YAML; --model anthropic/claude-haiku-4.5 returns [] — namespaced id fails on raw view (related --model filter).

## Evidence

```bash
$ poe-code models --view raw --model claude-haiku-4.5
- id: claude-haiku-4.5
…
$ poe-code models --view raw --model anthropic/claude-haiku-4.5
[]
```

## Why it matters

Namespaced ids used elsewhere fail silently as empty JSON/YAML array.

## Suggested direction

Accept namespaced ids; consistent empty message not [].

## Severity

**High**

## Area

Models

---
severity: medium
impact: polish
comment: "Keep of this pair as the clearer statement: '(empty)' hash rows with dashes are table chrome pretending to be data, and the fix already exists in the adjacent command - templates clear says 'No local runtime template cache entries'. Same empty-state inconsistency as the plan list/harness list disagreement: one surface prints a message, its neighbour draws empty rows."
---

# UX: runtime templates ls shows empty hash rows

## Summary

runtime templates ls shows docker and e2b rows with Hash (empty) and blank artifact/Dockerfile/Built — looks like blank-ID table chrome with no useful empty message.

## Evidence

```bash
$ poe-code runtime templates ls
│ docker │ (empty) │ - │ - │ - │
│ e2b    │ (empty) │ - │ - │ - │
```

## Why it matters

Empty cache should say No cached templates rather than empty rows.

## Suggested direction

No local runtime template cache entries. (like clear message)

## Severity

Medium

## Area

Runtime

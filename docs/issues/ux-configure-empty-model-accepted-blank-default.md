---
severity: high
impact: correctness
comment: "Real and distinct from the catalog-validation issue: --model \"\" is not an unknown id but a blank value that survives into a planned settings rewrite, so a catalog check that only validates non-empty strings could still miss it. Keep as the empty-string case and fix alongside ux-configure-accepts-any-string-as-model-no-catalog-check.md; same empty-flag family as ux-agent-empty-api-key-silently-uses-stored.md."
---

# UX: configure --model "" accepted as blank default model

## Summary

configure claude --model "" --yes --dry-run shows blank default model and still plans full settings rewrite — empty model not rejected (empty flag class).

## Evidence

```bash
$ poe-code configure claude --model "" --yes --dry-run
◇  Claude Code default model
│     
# blank model; continues to plan full settings rewrite
```

## Why it matters

Empty model should ValidationError before any plan; related catalog validation Critical.

## Suggested direction

Reject empty --model. Model must not be empty.

## Severity

**High**

## Area

Configure

# UX: models --view capabilities --model anthropic/… returns empty (reconfirmed)

## Summary

models --view capabilities --model claude-sonnet-4.6 works (1/341); --model anthropic/claude-sonnet-4.6 → 0/341 — namespaced id fails on capabilities view (same class as pricing/parameters/raw).

## Evidence

```bash
$ poe-code models --view capabilities --model claude-sonnet-4.6
●  1/341 anthropic/claude-sonnet-4.6
$ poe-code models --view capabilities --model anthropic/claude-sonnet-4.6
●  0/341 No models match
```

## Why it matters

Reconfirm namespaced id footgun across models views.

## Suggested direction

Accept namespaced ids on all --model filters.

## Severity

**High**

## Area

Models

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

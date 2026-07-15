---
severity: low
impact: none
comment: "Positive pattern; consolidate with the other test-works positives into one note. Collectively they are the control the sonnet-5 cluster needs - every agent's health check passes with a live model - which is worth stating once rather than per agent."
---

# UX: test goose with valid model succeeds (positive)

## Summary

test goose --model anthropic/claude-haiku-4.5 succeeds with Tested Goose framing.

## Evidence

```bash
$ poe-code test goose --model anthropic/claude-haiku-4.5
◆  Goose health check
◆  Tested Goose.
```

## Why it matters

Positive multi-agent health check path.

## Suggested direction

Keep; ensure defaults use live models.

## Severity

Low

## Area

Test / positive pattern

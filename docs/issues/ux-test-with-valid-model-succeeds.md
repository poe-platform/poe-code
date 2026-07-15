---
severity: low
impact: none
comment: "Positive pattern; consolidate with the other test-works positives. Its framing is the useful one and states the sonnet-5 conclusion precisely: the health check works once the model is valid, so the default is the only defect."
---

# UX: test with valid --model succeeds (positive after stale model)

## Summary

test claude --model anthropic/claude-haiku-4.5 succeeds with Tested Claude Code framing when model is valid — shows health check works once model is fixed.

## Evidence

```bash
$ poe-code test claude --model anthropic/claude-haiku-4.5
◆  Claude Code health check
◆  Tested Claude Code.
```

## Why it matters

Positive path; contrast with default stale model failures.

## Suggested direction

Default health-check model should be catalog-valid.

## Severity

Low

## Area

Test / positive pattern

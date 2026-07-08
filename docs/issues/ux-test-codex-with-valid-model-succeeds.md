# UX: test codex with valid model succeeds (positive)

## Summary

test codex --model openai/gpt-5.3-codex succeeds with design-system Tested Codex framing.

## Evidence

```bash
$ poe-code test codex --model openai/gpt-5.3-codex
◆  Codex health check
◆  Tested Codex.
```

## Why it matters

Positive health-check path when model valid.

## Suggested direction

Default test models should be catalog-valid per agent.

## Severity

Low

## Area

Test / positive pattern

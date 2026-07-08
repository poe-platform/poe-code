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

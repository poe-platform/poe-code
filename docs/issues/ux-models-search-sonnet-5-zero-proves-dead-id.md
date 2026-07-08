# UX: models --search sonnet-5 returns 0 (catalog proves dead id)

## Summary

models --search sonnet-5 and --search claude-sonnet-5 return 0/341 — catalog has no sonnet-5; product defaults still hard-code it. Live proof dead id is absent from API.

## Evidence

```bash
$ poe-code models --search sonnet-5
●  0/341 No models match
$ poe-code models --search claude-sonnet-5
●  0/341 No models match
# live catalog has anthropic/claude-sonnet-4.6
```

## Why it matters

Reconfirm Critical dead sonnet-5 with catalog evidence.

## Suggested direction

Replace all sonnet-5 defaults with sonnet-4.6; CI FRONTIER_MODELS resolve.

## Severity

**High**

## Area

Config / models

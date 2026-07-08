# UX: models pricing/capabilities empty for namespaced anthropic/ ids

## Summary

models --view pricing|capabilities --model anthropic/claude-haiku-4.5 → 0/341; bare claude-haiku-4.5 works. Same namespaced-id footgun as raw/parameters views.

## Evidence

```bash
$ poe-code models --view pricing --model anthropic/claude-haiku-4.5
●  0/341 No models match
$ poe-code models --view pricing --model claude-haiku-4.5
●  1/341 anthropic/claude-haiku-4.5 pricing table
```

## Why it matters

Users paste full catalog ids (namespaced) used everywhere else and get empty results.

## Suggested direction

Accept namespaced ids on all --model filters; strip provider prefix when matching id.

## Severity

**High**

## Area

Models

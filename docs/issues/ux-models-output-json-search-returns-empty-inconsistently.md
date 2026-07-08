# UX: models --output json --search haiku returns empty vs terminal 1 hit

## Summary

models --search haiku (terminal) → 1/341 haiku; models --output json --search haiku → 0/341 empty — JSON output path breaks search filter.

## Evidence

```bash
$ poe-code models --search haiku
●  1/341 models (anthropic/claude-haiku-4.5)
$ poe-code models --output json --search haiku
●  0/341 models
```

## Why it matters

Machine-readable path disagrees with human path — CI scripts break.

## Suggested direction

Fix JSON pipeline to apply same filters; add tests for --output json + --search.

## Severity

**High**

## Area

Models

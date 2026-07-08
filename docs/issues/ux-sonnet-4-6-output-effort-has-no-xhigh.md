# UX: sonnet-4.6 output_effort has no xhigh but configure still writes xhigh

## Summary

models --view parameters --model claude-sonnet-4.6 shows output_effort enum max, high, medium, low, none (default medium). configure still plans effortLevel xhigh which is not in sonnet-4.6 parameter set.

## Evidence

```bash
$ poe-code models --view parameters --model claude-sonnet-4.6
output_effort enum: max, high, medium, low, none (default medium)
$ poe-code configure claude --model anthropic/claude-sonnet-4.6 --yes --dry-run
+"effortLevel": "xhigh"
```

## Why it matters

Default effort is invalid for the target model family.

## Suggested direction

Map effortLevel to model-supported values; default medium per catalog.

## Severity

**High**

## Area

Configure / models

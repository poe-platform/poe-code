# UX: superintendent complete wrong kind uses --debug stack tease

## Summary

superintendent complete on plan-kind file: frontmatter kind must be superintendent Use --debug for a stack trace — good kind check, bad debug tease + toolcraft style.

## Evidence

```bash
$ poe-code superintendent complete docs/plans/32-agent-goal.md
■  … kind must be "superintendent" Use --debug for a stack trace.
```

## Why it matters

Kind mismatch should be clean ValidationError without debug tease.

## Suggested direction

ValidationError; suggest superintendent docs path.

## Severity

Medium

## Area

Superintendent

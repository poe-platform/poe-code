# UX: Stale configured models fail only at run time

## Summary

Invalid configured model ids only fail mid gaslight/pipeline with API 400 and success checkmarks.

## Evidence

✓ agent: API Error: 400 Unsupported model claude-sonnet-5.

## Why it matters

Late failure wastes setup.

## Suggested direction

Validate on configure; preflight; user error with reconfigure hint.

## Severity

**High**

## Area

Config / models

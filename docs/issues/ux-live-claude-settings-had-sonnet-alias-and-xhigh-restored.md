# UX: live Claude settings had model sonnet + effortLevel xhigh (restored)

## Summary

During continuous audit status check, ~/.claude/settings.json had model: "sonnet" (unresolved alias from configure --model sonnet dry-run side path or concurrent write) and effortLevel: "xhigh" (invalid for sonnet-4.6). Restored model to claude-sonnet-4-6 and effortLevel to high.

## Evidence

```text
before: model=sonnet, effortLevel=xhigh
after restore: model=claude-sonnet-4-6, effortLevel=high
```
Related: configure alias write + always-xhigh Criticals.

## Why it matters

Live config can be left in broken state by configure footguns; agents fail late.

## Suggested direction

Catalog validate on write; resolve aliases; model-aware effort; doctor check.

## Severity

**High**

## Area

Config / models

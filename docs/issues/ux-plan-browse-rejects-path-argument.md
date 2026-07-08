# UX: plan browse rejects path argument (too many arguments)

## Summary

plan browse docs/plans/32-agent-goal.md fails error: too many arguments for browse. Expected 0 — users expect browse [path] like view.

## Evidence

```bash
$ poe-code plan browse docs/plans/32-agent-goal.md
error: too many arguments for 'browse'. Expected 0 arguments but got 1.
```

## Why it matters

Inconsistent with plan view [path]; discoverability of browse is TTY-only.

## Suggested direction

Accept optional path; non-TTY require path or --yes with clear message.

## Severity

Medium

## Area

Plan

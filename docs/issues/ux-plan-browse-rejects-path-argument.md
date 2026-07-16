---
severity: medium
impact: usability
comment: "Good pairing with the non-TTY dump trio and arguably the more useful half: browse refuses a path while view accepts one, so the natural workaround for the non-TTY dump is unavailable. Together they describe one coherent gap - browse has no non-interactive contract at all. Fix both at once: accept an optional path and require it (or list) when there is no TTY."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/plan.ts:570 browse declares no .argument while src/cli/commands/plan.ts:607 view declares [path]; `npm run dev -- plan browse docs/plans/32-agent-goal.md` prints: error: too many arguments for 'browse'. Expected 0 arguments but got 1."
---

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

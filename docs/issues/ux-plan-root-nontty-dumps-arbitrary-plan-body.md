---
severity: high
impact: usability
comment: "Duplicate of ux-plan-root-non-tty-dumps-arbitrary-body.md; retire into it. Note the two name different plans as the dump victim (agent-goal here, toolcraft human-in-loop there), which usefully confirms the selection is genuinely arbitrary rather than 'first' - resolving the discrepancy in ux-plan-browse-non-tty-dumps-first-plan.md."
---

# UX: bare plan non-TTY dumps an arbitrary plan body

## Summary

plan with no args/subcommands in non-TTY dumps full body of some plan (Agent goal…) instead of list or fail-fast requiring browse/list/--yes.

## Evidence

```bash
$ poe-code plan
Agent goal — autonomous objective with budget & continuation
… full plan dump …
```

## Why it matters

Non-TTY bare plan is surprising; should list or require path.

## Suggested direction

Non-TTY: plan list or ValidationError: pass plan list|view|browse.

## Severity

**High**

## Area

Plan / non-TTY

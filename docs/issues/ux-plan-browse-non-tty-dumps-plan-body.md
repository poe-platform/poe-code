---
severity: high
impact: usability
comment: "Duplicate within the plan browse non-TTY trio; retire into ux-plan-browse-non-tty-dumps-arbitrary-plan-body.md. Its extra observation is worth carrying: bare 'poe-code plan' does the same thing, so the parent group also dumps a plan - linking this to ux-plan-root-non-tty-dumps-arbitrary-body.md and the group-command shape question."
---

# UX: plan browse non-TTY dumps plan body instead of failing or listing

## Summary

plan browse without TTY dumps a full plan markdown body (looks like plan view of first plan) rather than ValidationError requiring TTY or falling back to plan list.

## Evidence

```bash
$ poe-code plan browse
# dumps long plan content (toolcraft human-in-loop plan text)
$ poe-code plan
# also dumps plan content without question
```

## Why it matters

Non-interactive browse should list or error, not print arbitrary plan.

## Suggested direction

Non-TTY: plan list equivalent or Error: plan browse requires a TTY.

## Severity

**High**

## Area

Plan / non-TTY

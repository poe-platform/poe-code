---
severity: high
impact: data-loss
comment: "Duplicate of ux-gaslight-plan-path-starts-implement-without-confirm.md via the --plans flag rather than the positional path; retire into it. Its coverage value is real though: the Implement default is not tied to one entry point, so the fix belongs in gaslight's prompt construction rather than in argument handling."
---

# UX: gaslight --plans still auto-Implements (reconfirm class)

## Summary

gaslight --plans docs/plans/32-agent-goal.md --mode read --yes still Prompt: Implement … and starts agent work — same auto-Implement as path arg.

## Evidence

gaslight --plans … → Implement <path> + agent starts.

## Why it matters

Reconfirm gaslight Implement footgun.

## Suggested direction

Default Review; require --implement.

## Severity

**High**

## Area

Gaslight

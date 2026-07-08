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

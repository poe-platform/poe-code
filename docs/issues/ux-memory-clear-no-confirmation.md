---
severity: medium
impact: discoverability
comment: "Factually wrong and should be closed rather than merged: it asserts memory clear has no confirmation, inferred from help text, while ux-memory-clear-requires-yes-non-tty-good.md and ux-memory-clear-requires-yes-help-omits-yes.md both show the command refuses without --yes non-TTY. The clearest example in the audit of a defect invented by reading help instead of running the command. The residual truth is only the help gap."
---

# UX: memory clear no confirmation

## Summary

Destructive no confirm.

## Evidence

memory clear help.

## Why it matters

Costly accident.

## Suggested direction

Confirm/--yes.

## Severity

Medium

## Area

Destructive

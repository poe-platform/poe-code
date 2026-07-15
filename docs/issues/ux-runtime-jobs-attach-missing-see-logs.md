---
severity: medium
impact: usability
comment: "Duplicate within the runtime-jobs not-found trio (attach variant); retire. Filing the same message once per subcommand is mechanical duplication - the message comes from one lookup."
---

# UX: runtime jobs attach missing id has See logs

## Summary

runtime jobs attach missing: No runtime job found + See logs — same class as stop/logs.

## Evidence

No runtime job found for "missing".
●  See logs …

## Why it matters

UserError without logs.

## Suggested direction

UserError; suggest runtime jobs ls.

## Severity

Medium

## Area

Runtime jobs

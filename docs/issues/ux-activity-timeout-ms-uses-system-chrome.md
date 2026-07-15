---
severity: medium
impact: usability
comment: "Canonical filing for timeout-as-system-error. Valid: an activity timeout is an expected user condition, so system error chrome plus a 'See logs' tease sends users to logs that explain nothing. Fix is UserError plus an actionable hint to raise --activity-timeout-ms. Absorbs ux-activity-timeout-1ms-works-but-chrome.md."
---

# UX: --activity-timeout-ms timeout uses system error chrome

## Summary

spawn … --activity-timeout-ms 1 fails Agent spawn timed out after 0.001s of inactivity with See logs — timeout is expected user condition not system failure.

## Evidence

```bash
$ poe-code spawn … --activity-timeout-ms 1
■  Error: Agent spawn timed out after 0.001s of inactivity
●  See logs …
```

## Why it matters

Timeouts should be clean UserError without log tease.

## Suggested direction

UserError; suggest raising --activity-timeout-ms.

## Severity

Medium

## Area

Spawn / timeouts

---
severity: medium
impact: usability
comment: "Keep of this trio (covers both logs and restart). Standard systemic UserError chrome instance - the message is already correct and only 'See logs' is wrong - so retire into ux-user-errors-look-like-system-failures.md, keeping the 'suggest launch status' recovery. Note it contradicts ux-launch-logs-missing-says-runtime-job.md on the actual message text; settle that first."
---

# UX: launch logs/restart missing process uses system chrome

## Summary

Managed process "missing" was not found + See logs for launch logs/restart.

## Evidence

```bash
$ poe-code launch logs missing
■  Error: Managed process "missing" was not found.
●  See logs …
```

## Why it matters

Not-found should suggest launch status; no logs.

## Suggested direction

ValidationError + launch status hint.

## Severity

Medium

## Area

Launch

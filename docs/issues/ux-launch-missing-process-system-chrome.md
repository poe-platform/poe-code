---
severity: medium
impact: usability
comment: "Keep of this trio (covers both logs and restart). Standard systemic UserError chrome instance - the message is already correct and only 'See logs' is wrong - so retire into ux-user-errors-look-like-system-failures.md, keeping the 'suggest launch status' recovery. Note it contradicts ux-launch-logs-missing-says-runtime-job.md on the actual message text; settle that first."
reproduced: y
recommendation: fix
evidence: "launch restart missing prints 'Error: Managed process missing was not found.' plus 'See logs at ~/.poe-code/logs/errors.log' (exit 1): plain Error at packages/process-launcher/src/launcher.ts:226 is not a UserError, so src/cli/bootstrap.ts:71-79 adds system chrome. Note: launch logs missing throws nothing (readManagedLogs launcher.ts:297 tails empty dir, exit 0), so the logs half of the doc's evidence block is wrong."
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

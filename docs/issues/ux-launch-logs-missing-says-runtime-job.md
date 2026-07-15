---
severity: high
impact: usability
comment: "Conflicts with ux-launch-missing-process-system-chrome.md and ux-launch-restart-missing-see-logs.md: those report 'Managed process \"missing\" was not found' for the same launch logs invocation, while this reports 'No runtime job found for \"missing\"'. Two different messages for one command means either two code paths or a change between probes - resolve which before fixing. The point stands if the message is real: 'runtime job' is the wrong subsystem noun for launch, the same vocabulary-leak class as approvals saying 'Task'."
---

# UX: launch logs missing id says No runtime job found

## Summary

launch logs missing: No runtime job found for "missing" + See logs — wrong subsystem name (launch vs runtime jobs); confuses users.

## Evidence

```bash
$ poe-code launch logs missing
■  Error: No runtime job found for "missing".
●  See logs …
```

## Why it matters

Launch process errors should say managed process not runtime job.

## Suggested direction

No managed process found for "missing". Try launch status.

## Severity

**High**

## Area

Launch

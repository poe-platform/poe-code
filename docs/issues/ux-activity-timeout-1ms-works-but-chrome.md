---
severity: low
impact: usability
comment: "Mis-filed as a positive pattern: the only complaint here (timeout rendered with 'See logs' system chrome) is exactly what ux-activity-timeout-ms-uses-system-chrome.md files at Medium. Not an independent issue. Fold into that one and keep this only as evidence that 1ms timeout enforcement works."
reproduced: y
recommendation: no-fix
evidence: "createActivityTimeoutError throws a plain Error (packages/agent-harness-tools/src/run-poe-command.ts:635-639), not CliError/isUserError, so src/cli/bootstrap.ts:71-79 prints 'Error: ...' plus 'See logs at .../errors.log'; duplicate of canonical ux-activity-timeout-ms-uses-system-chrome.md which states it absorbs this file."
---

# UX: activity-timeout-ms 1 kills spawn correctly but system chrome

## Summary

Agent spawn timed out after 0.001s of inactivity — correct behavior for extreme timeout; still See logs.

## Evidence

```bash
$ poe-code spawn … --activity-timeout-ms 1
■  Error: Agent spawn timed out after 0.001s of inactivity
```

## Why it matters

Positive timeout enforcement; UserError without logs.

## Suggested direction

Keep timeout; drop See logs.

## Severity

Low

## Area

Spawn / positive pattern

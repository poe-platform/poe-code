---
severity: medium
impact: usability
comment: "Third duplicate within the runtime-jobs not-found trio; retire into the consolidated issue. No distinct content."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/runtime/jobs/shared.ts:35 throws plain Error, not CliError isUserError, so src/cli/bootstrap.ts:71-81 adds 'Error:' prefix plus See logs. Probe 'npm run dev -- runtime jobs logs missing' printed: Error: No runtime job found for \"missing\". / See logs at ~/.poe-code/logs/errors.log. Duplicate of ux-runtime-job-missing-see-logs.md and ux-runtime-jobs-attach-missing-see-logs.md; same root fix."
---

# UX: runtime jobs logs/stop missing id has See logs

## Summary

runtime jobs logs|stop missing: No runtime job found + See logs — clear message, system chrome residual.

## Evidence

No runtime job found for "missing".
●  See logs …

## Why it matters

UserError without logs; suggest runtime jobs ls.

## Suggested direction

UserError; suggest ls.

## Severity

Medium

## Area

Runtime jobs

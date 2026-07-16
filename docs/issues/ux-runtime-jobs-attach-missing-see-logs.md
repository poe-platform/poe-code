---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "Probe 'npm run dev -- runtime jobs attach missing' printed 'Error: No runtime job found for \"missing\".' plus 'See logs at ~/.poe-code/logs/errors.log' and exited 1. Cause: resolveJob throws plain Error at src/cli/commands/runtime/jobs/shared.ts:35 (called by attach.ts:45), and src/cli/bootstrap.ts:71-81 appends the See-logs chrome for any error that is not a CliError with isUserError. Behaviour is real, but stop/logs/sync hit the same single throw, so this attach filing duplicates ux-runtime-job-missing-see-logs.md."
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

---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "Probe 'npm run dev -- models --since bogus' printed the message via logException (src/cli/logger.ts:174), then 'Stack trace: ValidationError ... at parseSinceDuration (src/cli/commands/models.ts:188:11)' because src/cli/error-logger.ts:151 appends the stack to stderr (logToStderr:true, src/cli/container.ts:91) with no isUserError check, then models.ts:546 rethrows and src/cli/bootstrap.ts:71-73 logs the bare message a second time - stack leak plus double render both real"
comment: "Keep as the umbrella for the stack-leak family (the models --since and --endpoint filings are its instances). Its point is sharp: a ValidationError that prints a stack undoes the entire purpose of classifying it, so this is the second half of ux-user-errors-look-like-system-failures.md - one classifies, this one renders. Fix both together: isUserError implies no stack and no log pointer. Its double-render observation also connects to the four double-error sightings, which may share a handler."
---

# UX: Some ValidationErrors still print stacks

## Summary

ValidationError paths dump stack + double-render.

## Evidence

models --since bad → stack + message twice.

## Why it matters

Undoes ValidationError point.

## Suggested direction

No stacks for isUserError.

## Severity

**High**

## Area

Errors

---
severity: high
impact: usability
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

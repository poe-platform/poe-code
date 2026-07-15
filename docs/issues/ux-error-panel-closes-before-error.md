---
severity: high
impact: usability
comment: "Thin but names a genuine ordering bug with real consequence: the panel outro (including the Problems? footer) renders before the error, so the output reads as success and then contradicts itself. Same lifecycle family as ux-auth-status-spinner-pre-panel.md - progress and outro are emitted around a body that may still throw. Fix in the panel lifecycle: never outro before a rethrow. Needs the exact transcript pasted, though the 'agent \"\"' repro is reproducible enough to work from."
---

# UX: Panel outro prints before the error

## Summary

finalize Problems? then detached error.

## Evidence

agent "" → Problems? then Error empty prompt.

## Why it matters

Success-looking close then fail.

## Suggested direction

Never outro before rethrow.

## Severity

**High**

## Area

Errors / design system

---
severity: high
impact: usability
comment: "Thin but names a genuine ordering bug with real consequence: the panel outro (including the Problems? footer) renders before the error, so the output reads as success and then contradicts itself. Same lifecycle family as ux-auth-status-spinner-pre-panel.md - progress and outro are emitted around a body that may still throw. Fix in the panel lifecycle: never outro before a rethrow. Needs the exact transcript pasted, though the 'agent \"\"' repro is reproducible enough to work from."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/agent.ts:72 calls context.finalize() inside finally; src/cli/context.ts:69 feedback('Problems?') maps to outro at src/cli/logger.ts:249, while the throw from packages/poe-agent/src/agent-session.ts:191 is only printed later by the catch in src/cli/bootstrap.ts:69-71"
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

---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "packages/agent-defs/src/agents/pi.ts:6 aliases: [pi-agent]; configs.test.ts:49 resolveSpawnableAgent('pi-agent') resolves to id pi; spawn-command.test.ts:3090 asserts spawn help lists pi-agent"
comment: "Positive pattern; near-duplicate of ux-cursor-and-cursor-agent-aliases-both-work.md - both establish that aliases resolve correctly and are undocumented. Consolidate into the alias documentation ask (ux-command-aliases-undocumented-on-root-help.md). Its detail that the panel title shows 'spawn pi' rather than the alias is a nice touch: the resolution is visible, which is better than silent."
---

# UX: pi-agent alias works (positive)

## Summary

spawn pi-agent resolves to pi and succeeds — positive alias behavior (title shows spawn pi).

## Evidence

```bash
$ poe-code spawn pi-agent "say only: ok" --mode read
┌   Poe - spawn pi
✓ agent: ok
```

## Why it matters

Positive alias; document pi-agent = pi in help.

## Suggested direction

Help note alias relationship.

## Severity

Low

## Area

Spawn / positive pattern

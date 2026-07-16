---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/spawn.ts:485-487 resolveSpawnMode returns 'yolo' for any agent when --yes is passed; packages/agent-spawn/src/configs/pi.ts:15-19 defines yolo/edit/read modes, so pi is not special-cased and no per-agent mode requirement exists"
comment: "Treat with caution rather than as reassurance: it reports spawn pi succeeding while ux-spawn-pi-demands-openrouter-not-poe.md reports it failing for want of an openrouter key. The likely explanation is ambient credentials on the audit machine, which would mean pi 'works' only by accident and not via Poe auth. Verify before citing it as a working path. Its observation that pi does not require --mode is the durable part and belongs in the capability matrix."
---

# UX: spawn pi --yes works (positive)

## Summary

spawn pi "say only: ok" --yes succeeds without --mode (pi may not require mode like claude).

## Evidence

spawn pi … --yes → ok

## Why it matters

Positive pi path with --yes.

## Suggested direction

Document mode requirements per agent.

## Severity

Low

## Area

Spawn / positive pattern

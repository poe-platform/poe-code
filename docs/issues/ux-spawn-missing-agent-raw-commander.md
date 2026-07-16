---
severity: medium
impact: usability
comment: "Instance of the raw-Commander missing-argument family; retire into ux-raw-commander-missing-args.md (or ux-agent-spawn-missing-args-raw-commander.md, which covers agent and spawn together). Its distinct ask is worth keeping: list the spawnable agents in the error, which the capability-matrix work would supply for free."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/spawn.ts:135 declares .argument(\"<agent>\", serviceDescription); bootstrap.ts:47 sets exitOverride false so Commander prints raw text. `npm run dev -- spawn` outputs: error: missing required argument 'agent'"
---

# UX: spawn missing agent is raw commander error

## Summary

spawn with no args: error: missing required argument agent — raw commander not design-system; no agent list.

## Evidence

error: missing required argument 'agent' 

## Why it matters

Should list spawnable agents.

## Suggested direction

ValidationError: Agent required. Expected claude|codex|…

## Severity

Medium

## Area

Spawn

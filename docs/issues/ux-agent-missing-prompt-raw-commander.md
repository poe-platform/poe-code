---
severity: medium
impact: usability
comment: "Duplicate of ux-agent-spawn-missing-args-raw-commander.md, which reports the same raw-Commander gap for both agent and spawn and is the better filing. Retire into it."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/agent.ts:21 declares .argument('<prompt>') and src/cli/program.ts:856 sets showHelpAfterError(false) with no ValidationError mapping; `npm run dev -- agent` prints: error: missing required argument 'prompt'"
---

# UX: agent missing prompt is raw commander error

## Summary

agent with no args: error: missing required argument prompt — raw commander.

## Evidence

error: missing required argument 'prompt' 

## Why it matters

Design-system ValidationError.

## Suggested direction

ValidationError: Prompt required. Pass text or @file.

## Severity

Medium

## Area

Agent

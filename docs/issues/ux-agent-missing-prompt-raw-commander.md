---
severity: medium
impact: usability
comment: "Duplicate of ux-agent-spawn-missing-args-raw-commander.md, which reports the same raw-Commander gap for both agent and spawn and is the better filing. Retire into it."
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

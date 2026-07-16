---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/spawn.ts:223 resolveSpawnMode runs before resolveSpawnTarget (spawn.ts:240/317), so 'spawn notanagent hi --mode foobar' prints 'Invalid --mode \"foobar\"...' while '--mode read' prints 'Error: Unknown agent \"notanagent\".' plus 'See logs at ...errors.log' because shared.ts:540 throws a plain Error, not a CliError user error (bootstrap.ts:71-80)"
comment: "Keep of this trio as the fullest statement (it tests both orders and catches that the unknown-agent error also wears system chrome). Consolidate ux-spawn-validates-mode-before-agent.md and ux-spawn-empty-agent-validates-mode-first.md into it. The defect is real: users are told to fix --mode when the agent name is the problem - the same misdiagnosis family as the code-review URL and gemini credential errors. Its 'show both' alternative is the pragmatic fix."
---

# UX: spawn validates mode before agent (reconfirmed)

## Summary

spawn unknown-agent --mode foobar fails mode first; spawn unknown-agent --mode read fails Unknown agent with See logs — mode-before-agent order reconfirmed; agent error still system chrome.

## Evidence

mode foobar → mode error; mode read + unknown agent → Unknown agent + See logs.

## Why it matters

Reconfirm validation order and agent error chrome.

## Suggested direction

Validate agent first or show both; UserError for unknown agent.

## Severity

Medium

## Area

Spawn

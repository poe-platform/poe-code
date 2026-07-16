---
severity: high
impact: usability
comment: "Duplicate within the --interactive quartet but with the sharpest single observation in it: the error mentions --print, a flag the user never passed, so the agent's internal invocation leaks into poe-code's error surface. That is the same passthrough problem as the raw git and resume errors, and the strongest argument for refusing -i without a TTY at the poe-code layer rather than letting the agent fail."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/spawn.ts:239-265 interactive branch has no process.stdin.isTTY gate (only assertInteractiveSupport); spawn.ts:489 gates --mode only and is bypassed by --mode read; packages/agent-spawn/src/spawn-interactive.ts:119-132 sets tty:true and inherits stderr, so claude's own non-TTY print-mode error ('...when using --print', cf. promptFlag '-p' at packages/agent-spawn/src/configs/claude-code.ts:8) reaches the user unframed. Duplicate of ux-spawn-interactive-non-tty-launches-agent-tui-copy.md (reproduced: y, recommendation: fix), whose TTY refusal removes this."
---

# UX: spawn -i without TTY dumps raw agent --print error

## Summary

Interactive spawn without prompt/TTY surfaces raw agent-native --print error outside design system.

## Evidence

spawn claude --mode read -i → Error: Input must be provided… when using --print.

## Why it matters

Users asked for -i; error mentions --print they never passed.

## Suggested direction

Validate -i requires TTY; product language.

## Severity

**High**

## Area

Spawn / interactive

---
severity: high
impact: usability
comment: "Duplicate within the --interactive quartet but with the sharpest single observation in it: the error mentions --print, a flag the user never passed, so the agent's internal invocation leaks into poe-code's error surface. That is the same passthrough problem as the raw git and resume errors, and the strongest argument for refusing -i without a TTY at the poe-code layer rather than letting the agent fail."
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

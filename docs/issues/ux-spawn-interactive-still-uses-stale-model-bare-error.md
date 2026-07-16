---
severity: high
impact: usability
comment: "Duplicate within the --interactive quartet, compounded by the dead sonnet-5 default; retire into the quartet's canonical and the constants cluster. Nothing here needs its own fix - refusing -i non-TTY and fixing the default both independently remove it. Its value is only as evidence of how the two defects stack."
reproduced: y
recommendation: no-fix
evidence: "packages/agent-spawn/src/spawn-interactive.ts:117-129 inherits child stdin/stdout/stderr with no model preflight, so raw agent 'API Error: 400' text passes through unframed; src/cli/commands/spawn.ts:489 gates only --mode on TTY, never -i; default model hardcoded at src/cli/constants.ts:14,18 (anthropic/claude-sonnet-5)"
---

# UX: spawn -i with prompt still hits stale model as bare API error

## Summary

Even with prompt and -i, non-TTY spawn can surface bare API Error: 400 Unsupported model without design-system panel when configured model is stale.

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read -i
API Error: 400 Unsupported model: 'claude-sonnet-5'.
```

## Why it matters

Interactive flag + prompt should not yield unframed API string; stacks with stale model and -i issues.

## Suggested direction

Design-system error; preflight model; refuse -i without TTY with clear message first.

## Severity

**High**

## Area

Spawn / interactive

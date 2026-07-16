---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "packages/agent-hook-config/src/bridge-hooks.ts:275 throws 'Transforming hooks from \"codex\" is not supported yet'; src/cli/commands/spawn.ts:111 --hooks-from is free-form with no capability filtering, resolveHookOptions (spawn.ts:630) only checks flag pairing"
comment: "Keep as canonical of this pair. Real: help advertises --hooks-from codex and the combination fails at runtime with 'not supported yet', so the flag surface promises a matrix the implementation lacks. Same shape as ux-hooks-strategy-transform-unsupported-opaque.md - unsupported combinations are reachable because choices are not capability-filtered. One fix for both: derive choices from the supported matrix and reject unsupported pairs at parse."
---

# UX: hooks-from codex to claude transform not supported

## Summary

spawn --hooks-from codex fails Transforming hooks from "codex" is not supported yet — help allows --hooks-from and transform strategy but codex→claude path unsupported.

## Evidence

```bash
$ poe-code spawn claude … --hooks-from codex
■  Error: Transforming hooks from "codex" is not supported yet
```

## Why it matters

Advertised combinations fail late.

## Suggested direction

Document supported source→target matrix; filter choices; ValidationError without logs.

## Severity

**High**

## Area

Hooks / spawn

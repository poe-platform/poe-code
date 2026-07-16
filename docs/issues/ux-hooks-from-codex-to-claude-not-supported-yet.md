---
severity: high
impact: usability
comment: "Duplicate of ux-hooks-from-codex-to-claude-transform-unsupported.md; retire into it. Both make the same correct and important point: --hooks-from accepts codex, so the unsupported pair is only discovered after the run starts. Validate the source/target matrix at parse time."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/spawn.ts:111 declares --hooks-from <agentId> with no choice restriction; codex resolves as a supported hook agent (packages/agent-hook-config/src/configs.ts:79, format codex-hooks-json), so strategy defaults to transform and packages/agent-hook-config/src/bridge-hooks.ts:275 throws 'Transforming hooks from \"codex\" is not supported yet' only at run time. No-fix here: duplicate, canonical is ux-hooks-from-codex-to-claude-transform-unsupported.md"
---

# UX: hooks-from codex→claude still not supported yet

## Summary

spawn --hooks-from codex: Transforming hooks from "codex" is not supported yet + See logs — late failure after help advertises hooks-from.

## Evidence

Transforming hooks from "codex" is not supported yet

## Why it matters

Reconfirm hooks source→target matrix; should validate at flag parse.

## Suggested direction

Capability matrix; reject unsupported pairs early without See logs.

## Severity

**High**

## Area

Hooks / spawn

---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "Drift is real: packages/agent-skill-config/src/configs.ts:12-39 skill supportedAgents = claude-code, codex, cursor, gemini-cli, opencode, goose (no kimi, though src/providers/kimi.ts:22 configures it); spawn adds pi (packages/agent-spawn/src/configs/pi.ts) and poe-agent (src/cli/commands/spawn-poe-agent.ts). No 'wrap' command exists in src/cli/commands, so that sub-claim is unverifiable. Duplicate of ux-agent-capability-matrix-spawn-vs-configure-vs-install.md, which carries the fix."
comment: "Duplicate of ux-agent-capability-matrix-spawn-vs-configure-vs-install.md, which has the evidence; retire into it. Its added coverage is worth carrying: wrap and skill diverge too (wrap missing cursor, skill missing kimi), so the matrix spans more commands than the canonical names - strengthening the case for deriving every agent list from one capability source."
---

# UX: Agent support matrix differs across commands

## Summary

configure/wrap/spawn/skill different agent unions.

## Evidence

wrap missing cursor; spawn has poe-agent; skill missing kimi.

## Why it matters

No mental model.

## Suggested direction

Single capability matrix.

## Severity

**High**

## Area

Agents

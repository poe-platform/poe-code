---
severity: low
impact: none
comment: "Keep as the canonical positive of this pair: it has the live run plus the constants and it names the real insight - a split brain where DEFAULT_FRONTIER_MODEL is live while DEFAULT_CLAUDE_CODE_MODEL is dead sonnet-5. Its value is as supporting evidence for the Critical sonnet-5 cluster, not as a standalone issue. Retire ux-agent-default-model-is-opus-4-7-good.md into it."
reproduced: n
recommendation: no-fix
evidence: "Positive note, no defect: src/cli/constants.ts:9 DEFAULT_FRONTIER_MODEL = anthropic/claude-opus-4.7 used by src/cli/commands/agent.ts:47 and src/providers/poe-agent.ts:750; the dead sonnet-5 default it contrasts with is src/cli/constants.ts:14,18 and is tracked in ux-constants-source-of-dead-sonnet-5.md"
---

# UX: agent default model (opus-4.7) works (positive contrast to sonnet-5)

## Summary

agent "say only: ok" without --model succeeds using default anthropic/claude-opus-4.7 — positive that DEFAULT_FRONTIER_MODEL works while CLAUDE_CODE default sonnet-5 fails.

## Evidence

```bash
$ poe-code agent "say only: ok"
✓ agent: ok
◆  Agent response received.
```
constants: DEFAULT_FRONTIER_MODEL = opus-4.7; DEFAULT_CLAUDE_CODE_MODEL = sonnet-5.

## Why it matters

Shows split brain: agent path OK, claude configure path poisoned.

## Suggested direction

Align claude default to live catalog like agent default.

## Severity

Low

## Area

Agent / positive pattern

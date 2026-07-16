---
severity: low
impact: polish
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/spawn.ts:220 throws 'No prompt provided via argument or stdin' when promptText is empty; packages/poe-agent/src/agent-session.ts:190-191 throws 'Prompt must not be empty.' via normalizeNonEmptyString check reached from src/cli/commands/agent.ts:53 sendMessage - both reject empty prompts with different wording"
comment: "Positive pattern that quietly documents a real inconsistency: spawn says 'No prompt provided via argument or stdin' while agent says 'Prompt must not be empty' for the same user error. Both behaviors are correct, so the residue is wording unification - fold into the empty-flag policy work (ux-empty-model-flag-behavior-inconsistent.md), where identical inputs should produce consistent messages across commands."
---

# UX: empty prompt string rejected (positive for spawn/agent)

## Summary

spawn claude "" and agent "" both reject empty prompts — good. spawn: No prompt provided; agent: Prompt must not be empty (slight wording inconsistency).

## Evidence

```bash
$ poe-code spawn claude "" --mode read --model haiku
■  Error: No prompt provided via argument or stdin
$ poe-code agent "" --model haiku
■  Error: Prompt must not be empty.
```

## Why it matters

Positive empty-prompt rejection; unify wording.

## Suggested direction

Unify message; drop See logs.

## Severity

Low

## Area

Spawn / positive pattern

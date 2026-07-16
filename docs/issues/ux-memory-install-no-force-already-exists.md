---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/memory.ts:447-451 declares only --global/--skill-only/--mcp-only/--allow-writes (no --force), and the installMemory call at memory.ts:456-467 passes no force; packages/memory/src/install.ts:33-50 forwards only fs/cwd/homeDir/scope/dryRun/observers to installSkill, whose options accept no force (force exists only on unconfigure at packages/agent-skill-config/src/apply.ts:90/126) and apply.ts:193-195 throws plain Error 'Skill already exists' unconditionally"
comment: "Keep of this pair as the capability statement: there is no --force at all, so an existing skill cannot be updated without deleting it by hand. Worse than the experiment case (ux-experiment-install-force-still-fails-already-exists.md) where --force exists but lies - here it is simply absent, which also makes memory a member of ux-install-skill-flags-inconsistent-across-commands.md (its installer has a different flag set from every other). Its 'skip if identical' idea is the best answer in the family."
---

# UX: memory install has no --force when skill already exists

## Summary

memory install --agent claude --skill-only fails Skill already exists … See logs; no --force on help; reinstall blocked.

## Evidence

```bash
$ poe-code memory install --agent claude --skill-only
■  Error: Skill already exists: .claude/skills/poe-code-memory/SKILL.md
●  See logs …
```
--force unknown.

## Why it matters

Cannot update memory skill without manual delete.

## Suggested direction

Add --force overwrite; UserError without logs; skip if identical.

## Severity

Medium

## Area

Memory

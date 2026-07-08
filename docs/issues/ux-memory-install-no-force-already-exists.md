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

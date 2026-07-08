# UX: memory install "Skill already exists" uses system-error chrome

## Summary

memory install when skill exists fails with Skill already exists: path and See logs, without --force guidance or design-system-only user error.

## Evidence

```bash
$ poe-code memory install --agent claude-code --skill-only --global
■  Error: Skill already exists: ~/.claude/skills/poe-code-memory/SKILL.md
●  See logs …
```

## Why it matters

Idempotent install should say already installed or offer --force; not look like a crash.

## Suggested direction

ValidationError: already installed; use --force to overwrite; skip errors.log.

## Severity

Medium

## Area

Memory / install

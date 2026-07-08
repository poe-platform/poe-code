# UX: skill configure fails Skill already exists with system chrome

## Summary

skill configure claude-code --yes (global default) fails Skill already exists: ~/.claude/skills/poe-generate.md + See logs — no --force, no skip-if-exists info.

## Evidence

```bash
$ poe-code skill configure --yes
■  Error: Skill already exists: …/poe-generate.md
●  See logs …
$ poe-code skill configure claude-code --yes --local
◆  Configured skills for claude-code at ./.claude/skills
```

## Why it matters

Idempotent configure should skip or --force; global vs local inconsistency.

## Suggested direction

Skip existing with info; --force overwrite; no See logs.

## Severity

**High**

## Area

Skills

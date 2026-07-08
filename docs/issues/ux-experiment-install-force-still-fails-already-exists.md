# UX: experiment install --force still fails Skill already exists

## Summary

experiment install --agent claude --local --force fails Error: Skill already exists even with --force documented on help. Dry-run and real both fail; --force does not overwrite.

## Evidence

```bash
$ poe-code experiment install --agent claude --local --force
■  Error: Skill already exists: .claude/skills/poe-code-experiment-plan/SKILL.md
●  See logs …
# help says: --force Overwrite existing files
```

## Why it matters

--force help lies; users cannot reinstall/update experiment skill.

## Suggested direction

Make --force overwrite; dry-run should show would overwrite.

## Severity

**High**

## Area

Experiment / install

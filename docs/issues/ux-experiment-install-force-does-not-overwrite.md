---
severity: high
impact: usability
comment: "Duplicate of the experiment --force trio; retire into ux-experiment-install-force-still-fails-already-exists.md. Its one useful nuance is the alternative reading it offers: if --force only scaffolds other files and was never meant to touch the skill, the help is the bug rather than the behavior - settle that before implementing an overwrite."
---

# UX: experiment install --force still errors Skill already exists

## Summary

experiment install --local --force still fails Skill already exists — --force does not overwrite despite help saying Overwrite existing files.

## Evidence

```bash
$ poe-code experiment install --help
  --force         Overwrite existing files
$ poe-code experiment install --agent claude-code --local --force
■  Error: Skill already exists: .claude/skills/poe-code-experiment-plan/SKILL.md
```

## Why it matters

Documented --force is a lie; blocks reinstall.

## Suggested direction

Honor --force overwrite; or fix help if force only scaffolds other files.

## Severity

**High**

## Area

Experiment / install

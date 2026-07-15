---
severity: high
impact: usability
comment: "One of three filings of the same --force defect; consolidate into ux-experiment-install-force-still-fails-already-exists.md, which adds that dry-run fails too. All three establish the same point: help documents '--force Overwrite existing files' and the behavior refuses, so the flag is a lie. Fix jointly with ux-experiment-install-already-exists-vs-pipeline-skip.md, which shows pipeline already does the right thing."
---

# UX: experiment install --force still fails Skill already exists

## Summary

experiment install --agent claude --local --force still: Skill already exists … See logs — --force documented but does not overwrite skill; only help mentions Overwrite existing files.

## Evidence

```bash
$ poe-code experiment install --agent claude --local --force
■  Error: Skill already exists: .claude/skills/poe-code-experiment-plan/SKILL.md
```
Help: --force Overwrite existing files.

## Why it matters

--force is a lie; users cannot reinstall/update experiment skill.

## Suggested direction

Honor --force for skill files; UserError without logs; --dry-run.

## Severity

**High**

## Area

Experiment / install

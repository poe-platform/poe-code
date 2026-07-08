# UX: experiment install errors on existing skill; pipeline install skips (inconsistent)

## Summary

experiment install when skill exists hard-errors Skill already exists; pipeline install --dry-run skips existing skill and reports would install. Same class of installers, different idempotency.

## Evidence

```bash
$ poe-code experiment install --agent claude-code --local
■  Error: Skill already exists: .claude/skills/poe-code-experiment-plan/SKILL.md
$ poe-code pipeline install --agent claude-code --local --dry-run
●  Skip: …/poe-code-pipeline-plan/SKILL.md (already exists)
●  Would install Pipeline skill…
```

## Why it matters

Idempotent installs should skip or --force consistently across installers.

## Suggested direction

Standardize: skip-if-exists (info) or require --force; never system-error for exists.

## Severity

**High**

## Area

Install / consistency

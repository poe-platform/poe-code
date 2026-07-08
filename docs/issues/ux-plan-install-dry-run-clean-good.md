# UX: plan install --yes --dry-run is clean (positive)

## Summary

plan install --agent claude --local --yes --dry-run: Would create SKILL.md; Would install; no filesystem changes — clean intentional dry-run.

## Evidence

Would create: .claude/skills/poe-code-plan/SKILL.md
Would install plan skill for claude-code (local).
# no filesystem changes

## Why it matters

Positive dry-run install pattern.

## Suggested direction

Keep; document --yes on help.

## Severity

Low

## Area

Plan install / positive pattern

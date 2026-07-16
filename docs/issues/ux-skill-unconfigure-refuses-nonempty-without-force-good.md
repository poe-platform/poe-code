---
severity: low
impact: none
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/skill.ts:399-406 refuses non-empty dir without --force; --force documented at src/cli/commands/skill.ts:296"
comment: "Correct as filed - refusing a non-empty directory without --force is good safety - but it is also the setup for the Critical: the refusal teaches users to add --force, and --force then deletes unrelated skills without further warning. So the guard is only half a guard: it detects the dangerous case and then offers a flag that makes it worse. Keep, and link the two; the refusal message should name what --force would remove."
---

# UX: skill unconfigure refuses nonempty without --force (positive)

## Summary

skill unconfigure claude: Skill directory … has files. Use --force to remove — clear safety (no --yes on help).

## Evidence

▲  Skill directory for claude-code at ~/.claude/skills has files. Use --force to remove.

## Why it matters

Positive destructive guard.

## Suggested direction

Keep; document --force on help (present).

## Severity

Low

## Area

Skills / positive pattern

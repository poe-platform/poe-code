---
severity: low
impact: none
comment: "Positive pattern and a useful boundary case: the missing-directory path is a clean no-op naming the agent and the path it checked. Its parenthetical contrast is the point - the same command with --force on an existing directory wipes everything (ux-skill-unconfigure-force-deletes-entire-skills-dir.md), so this proves the safe path is reachable and the destructive one is the outlier."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/skill.ts:413 logs 'No skill directory found for ${resolvedAgent} at ${displayPath}.' as a terminal no-op after the removed/force branches return; positive note, no defect to reproduce."
---

# UX: skill unconfigure goose when no dir is clear (positive)

## Summary

skill unconfigure goose --local: No skill directory found for goose at .agents/skills — clear no-op without force wipe.

## Evidence

●  No skill directory found for goose at .agents/skills.

## Why it matters

Positive missing-dir message (contrast --force wipe).

## Suggested direction

Keep.

## Severity

Low

## Area

Skills / positive pattern

---
severity: high
impact: data-loss
comment: "Important and under-rated: with --local the dry-run announces it would remove both ~/.claude/skills and .claude/skills, so a scope flag appears to reach outside its scope. Either the dry-run is wrong (a fidelity bug) or the behavior is (a data-loss bug touching the user's home directory) - and given ux-skill-unconfigure-force-deletes-entire-skills-dir.md proves this command really does delete whole trees, the second reading cannot be dismissed. Resolve urgently: run it with --local and check whether the home path is touched. The highest-value unanswered question in the skills cluster."
---

# UX: skill unconfigure dry-run shows both ~/.claude/skills and .claude/skills

## Summary

skill unconfigure claude-code --local --yes --dry-run says Would remove skills directory ~/.claude/skills AND Would remove skill directory for claude-code at .claude/skills — mixed home vs local paths for --local.

## Evidence

```bash
$ poe-code skill unconfigure claude-code --local --yes --dry-run
●  Would remove skills directory ~/.claude/skills
●  Would remove skill directory for claude-code at .claude/skills
```

## Why it matters

--local should not touch home path; scary and wrong.

## Suggested direction

Local only .claude/skills; global only ~/.…; never both for one scope.

## Severity

**High**

## Area

Skills

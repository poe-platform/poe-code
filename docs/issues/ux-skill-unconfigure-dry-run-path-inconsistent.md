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

# UX: skill configure --yes without agent silently defaults to claude-code

## Summary

skill configure --yes --local without agent silently configures claude-code skills — no confirmation of default agent selection in non-TTY.

## Evidence

```bash
$ poe-code skill configure --yes --local
◆  Configured skills for claude-code at ./.claude/skills
```

## Why it matters

Silent default agent on skill configure can surprise users; may write project files.

## Suggested direction

Require --agent non-TTY or print selected agent before write; support --dry-run.

## Severity

**High**

## Area

Skills

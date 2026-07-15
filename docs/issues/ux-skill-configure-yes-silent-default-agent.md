---
severity: high
impact: usability
comment: "Third duplicate within the skill configure silent-default trio; retire. Rated High against its Medium twins for identical behavior; normalise. Its aggravating detail is worth carrying: the silent default writes project files, so the consequence is a filesystem change rather than a config value - the same escalation as ux-plan-install-yes-defaults-claude-writes-skill.md."
---

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

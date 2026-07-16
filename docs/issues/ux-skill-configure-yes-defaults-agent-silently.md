---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/skill.ts:41-47 resolveSkillAgent returns resolveDefaultAgent or DEFAULT_SKILL_AGENT ('claude-code', line 18) under --yes with no announcement; configure action (lines 208-226) prints nothing about the defaulted agent"
comment: "One of three filings of the same silent-default-agent observation on skill configure; consolidate. All belong to the silent-defaults family whose rule is single: --yes announces every default it resolves. Its 'refuse without agent in CI' alternative is worth considering for commands that write project files."
---

# UX: skill configure --yes silently defaults agent

## Summary

skill configure --yes --local without agent configures claude-code without stating default selection policy up front.

## Evidence

```bash
$ poe-code skill configure --yes --local
◆  Configured skills for claude-code at ./.claude/skills
```

## Why it matters

Same silent default class as configure --yes; multi-agent users may not want Claude.

## Suggested direction

Print Using default agent; document order; optional refuse without agent in CI.

## Severity

Medium

## Area

Skills

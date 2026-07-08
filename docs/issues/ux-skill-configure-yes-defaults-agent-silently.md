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

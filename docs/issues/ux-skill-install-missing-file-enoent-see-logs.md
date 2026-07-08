# UX: skill install missing --file is ENOENT + See logs

## Summary

skill install with missing SKILL.md path: ENOENT open + See logs — should be ValidationError file not found.

## Evidence

ENOENT: no such file or directory, open '/tmp/no-skill.md'
●  See logs …

## Why it matters

UserError without logs.

## Suggested direction

Skill file not found: path.

## Severity

Medium

## Area

Skills

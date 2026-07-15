---
severity: medium
impact: usability
comment: "One of two identical filings of the raw ENOENT on a missing --file; consolidate, then retire into the shared path-validation issue (ux-mcp-servers-missing-file-almost-good.md proposes the helper). Same bare-throw family as gaslight --config, harness run, memory ingest and pipeline validate - five commands, one missing helper."
---

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

---
severity: medium
impact: polish
comment: "Keep as canonical of this pair (most complete: title, commands, usage line and section headers all unstyled). Its claim that this is the only completely unstyled help in the CLI makes it a useful probe rather than a nit - a single command bypassing the design system entirely suggests a different render path, and ux-memory-status-title-not-pink.md reports the same white title elsewhere, so the two may share a cause. Investigate together."
---

# UX: utils symlink --help renders entirely in white — design system not applied

## Summary

`poe-code utils symlink --help` renders its entire output in white unstyled text. No design system colors are applied:

- Title "Poe - utils symlink" is white (should be pink like every other command header)
- `Commands:` subcommands `agents` and `skills` are white (should be cyan)
- Usage line is white (should be cyan)
- No section headers are bold

Every other command in the CLI uses the pink/cyan/yellow design system. `utils symlink` is the only command whose help output is completely unstyled.

## Evidence

```
% poe-code utils symlink --help
Poe - utils symlink               ← white, not pink

Usage: poe-code utils symlink [options] [command]

Keep agent tool files interchangeable via symlinks.

Commands:
  agents   Symlink CLAUDE.md ← AGENTS.md (AGENTS.md is canonical).
  skills   Move .claude/skills into .agents/skills and symlink it back.
```

Compare to a correctly styled command where the title is pink and Commands are cyan.

## Why it matters

Breaks visual consistency. Users who see this help screen may wonder if the command is incomplete, from a different tool, or not part of poe-code.

## Severity

Medium

## Area

Utils / symlink / help / design system / visual consistency

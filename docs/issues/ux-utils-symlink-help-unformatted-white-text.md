---
severity: medium
impact: polish
comment: "Keep as canonical of this pair (most complete: title, commands, usage line and section headers all unstyled). Its claim that this is the only completely unstyled help in the CLI makes it a useful probe rather than a nit - a single command bypassing the design system entirely suggests a different render path, and ux-memory-status-title-not-pink.md reports the same white title elsewhere, so the two may share a cause. Investigate together."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/utils-symlink.ts:17-29 overrides configureHelp with a hardcoded formatHelp returning raw unstyled strings, bypassing text.heading/text.command/text.section used by formatSubcommandHelp at src/cli/program.ts:274 and program.ts:858-863. Probe with FORCE_COLOR=1 npm run dev: utils symlink --help emits zero ANSI escapes in its help body, while utils --help under identical piping emits pink bold title (95;1), bold sections, cyan commands (36), yellow options (33)."
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

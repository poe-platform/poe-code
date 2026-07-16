---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/utils-symlink.ts:18-32 configureHelp.formatHelp returns hardcoded plain strings with no text.* styling and no Options section, overriding the inherited styled formatSubcommandHelp wired at src/cli/program.ts:858-864. Probe: FORCE_COLOR=1 npm run dev -- utils symlink --help emits zero ANSI codes and no Options section, while worktree --help emits ESC[95m pink heading plus an Options block listing -h, --help."
comment: "Duplicate of ux-utils-symlink-help-unformatted-white-text.md, which documents the same unstyled help more completely; consolidate. Its distinct finding is worth carrying and is not cosmetic: the Options section is missing entirely, so users cannot see that -h is valid - a help-content gap rather than a colour issue."
---

# UX: utils symlink --help title renders in white, missing design-system pink color

## Summary

`utils symlink --help` shows the panel title "Poe - utils symlink" in plain white/grey text rather than the pink used by all other poe-code commands (e.g. `Poe - worktree`, `Poe - runtime`). The Options section is also entirely absent — only Commands are shown.

## Evidence

Screenshot: header "Poe - utils symlink" appears uncolored (white monospace), vs. the pink used by provider/worktree/runtime/auth help.

Missing from help output:
```
Options:
  -h, --help    Display help for command
```

## Why it matters

Breaks visual consistency — looks like a different tool. Missing Options section means users do not know `-h` is valid.

## Suggested direction

Apply design-system title color; add Options section with at least `-h, --help`.

## Severity

Medium

## Area

Utils / symlink / visual

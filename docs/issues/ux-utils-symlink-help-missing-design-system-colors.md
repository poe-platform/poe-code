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

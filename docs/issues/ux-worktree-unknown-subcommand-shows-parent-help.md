# UX: Unknown worktree subcommands silently show parent help instead of an error

## Summary

`poe-code worktree add --help` and `poe-code worktree archive --help` both render the parent `worktree` group help — with the title "Poe - worktree" — rather than showing "Unknown command: add" or similar.

The worktree group has three subcommands: `list`, `reconcile`, `remove`. Neither `add` nor `archive` exists. But running them with `--help` silently degrades to the parent help page.

## Evidence

```
% poe-code worktree add --help
Poe - worktree              ← parent group, not the subcommand

Usage: poe-code worktree [options]
```

## Why it matters

A user who types `poe-code worktree add` expecting to create a worktree sees the group help with no error. They may assume they got the right help page and are confused when no `add` flags appear. The correct behavior would be "Unknown subcommand: add" with a pointer to the available subcommands.

## Severity

Low

## Area

Worktree / unknown subcommand / error handling / help routing

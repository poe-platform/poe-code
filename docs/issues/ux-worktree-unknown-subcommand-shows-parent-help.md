---
severity: low
impact: usability
comment: "Good catch and a real defect rather than a nit: 'worktree add --help' silently renders the parent group help, so a user who invents a subcommand receives a help page that looks like an answer instead of an error. Silent degradation is worse than an unknown-command error because it withholds the fact that anything went wrong - and the did-you-mean cluster would make it recoverable. Note this file is absent from MASTER.md."
reproduced: y
recommendation: fix
evidence: "npm run dev -- worktree add --help prints 'Poe - worktree' parent help and exits 0, while 'worktree add' errors \"unknown command 'add'\"; commander 13.1.0 lib/command.js:1567 _outputHelpIfRequested runs before unknownCommand() at line 1609; src/cli/commands/worktree.ts:23-45 registers only list/reconcile/remove."
---

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

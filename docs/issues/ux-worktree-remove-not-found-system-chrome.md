---
severity: medium
impact: usability
comment: "Fifth filing within the worktree not-found chrome cluster; retire into ux-user-errors-look-like-system-failures.md. Five files for one message on two subcommands is count inflation."
reproduced: y
recommendation: no-fix
evidence: "packages/worktree/src/remove.ts:18 throws plain Error; src/cli/bootstrap.ts:71-80 adds 'Error:' prefix plus 'See logs' for non-CliError; duplicate of ux-user-errors-look-like-system-failures.md"
---

# UX: worktree remove not found uses system chrome

## Summary

worktree remove no-such → Worktree not found in registry + See logs.

## Evidence

```bash
$ poe-code worktree remove no-such --yes
■  Error: Worktree "no-such" not found in registry
●  See logs …
```

## Why it matters

Not-found should be ValidationError without logs; suggest worktree list.

## Suggested direction

UserError + worktree list hint.

## Severity

Medium

## Area

Worktree

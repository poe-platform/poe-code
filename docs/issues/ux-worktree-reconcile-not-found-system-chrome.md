---
severity: medium
impact: usability
comment: "One of five worktree not-found/chrome filings; consolidate. All are instances of ux-user-errors-look-like-system-failures.md where the message is already correct. The shared residue - suggest worktree list - is worth keeping since the registry is otherwise invisible."
reproduced: y
recommendation: fix
evidence: "packages/worktree/src/reconcile.ts:140 throws plain Error; src/cli/bootstrap.ts:70-79 only suppresses 'Error:' prefix and 'See logs at' hint for CliError with isUserError, so reconcile not-found renders system chrome"
---

# UX: worktree reconcile not found uses system chrome

## Summary

Worktree "missing" not found in registry + See logs — same as remove not-found.

## Evidence

```bash
$ poe-code worktree reconcile missing --agent claude
■  Error: Worktree "missing" not found in registry
●  See logs …
```

## Why it matters

Consistent not-found chrome cluster.

## Suggested direction

UserError + worktree list hint.

## Severity

Medium

## Area

Worktree

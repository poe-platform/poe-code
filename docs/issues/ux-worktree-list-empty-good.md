---
severity: low
impact: none
comment: "Directly contradicts ux-worktree-list-empty-state-unframed.md, which calls this same 'No managed worktrees.' output incomplete. Consolidate and settle the empty-state convention: plan list is criticised for drawing a bordered empty table, harness and worktree for printing a plain message - the three cannot all be wrong. Pick one convention and apply it."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/worktree.ts:54 logs 'No managed worktrees.' when entries.length === 0; positive note, no defect to reproduce"
---

# UX: worktree list empty is clear (positive)

## Summary

worktree list: No managed worktrees — clear empty state.

## Evidence

●  No managed worktrees.

## Why it matters

Positive empty list.

## Suggested direction

Keep.

## Severity

Low

## Area

Worktree / positive pattern

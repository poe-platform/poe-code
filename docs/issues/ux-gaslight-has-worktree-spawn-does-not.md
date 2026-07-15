---
severity: high
impact: capability-gap
comment: "Valid parity gap and better evidenced than the spawn-side twins, because it proves the capability already exists on gaslight - so this is propagation, not new work. Consolidate the three worktree filings here. Same shape as ux-agent-capability-matrix-spawn-vs-configure-vs-install.md: flags and agents are wired per command with nothing enforcing consistency."
---

# UX: gaslight has --worktree but spawn does not

## Summary

gaslight --help lists --worktree; spawn --worktree unknown — inconsistent worktree surface.

## Evidence

gaslight: --worktree Run in a managed git worktree…
spawn: unknown option --worktree

## Why it matters

Reconfirm unified --worktree on spawn.

## Suggested direction

Parity: spawn --worktree same as gaslight/superintendent.

## Severity

**High**

## Area

Spawn / worktree

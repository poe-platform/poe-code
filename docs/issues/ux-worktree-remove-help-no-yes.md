# UX: worktree remove help omits --yes confirmation policy

## Summary

worktree remove --help has --delete-branch but no --yes / confirmation notes for destructive remove.

## Evidence

worktree remove help: name, --delete-branch, -h only.

## Why it matters

Destructive command help incomplete.

## Suggested direction

Document confirmation; require --yes non-TTY.

## Severity

Medium

## Area

Worktree

# UX: worktree remove missing name has See logs

## Summary

worktree remove no-such-wt --yes: Worktree not found in registry + See logs — clear message, system chrome residual.

## Evidence

Error: Worktree "no-such-wt" not found in registry
●  See logs …

## Why it matters

UserError without logs.

## Suggested direction

UserError; suggest worktree list.

## Severity

Medium

## Area

Worktree

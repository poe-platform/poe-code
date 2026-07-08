# UX: worktree reconcile requires --agent via raw commander

## Summary

worktree reconcile missing --yes fails required option --agent not specified (raw) before not-found; --yes not in help.

## Evidence

error: required option '--agent <name>' not specified

## Why it matters

Validation order and raw commander on worktree.

## Suggested direction

Design-system ValidationError; optional agent default; document --yes.

## Severity

Medium

## Area

Worktree

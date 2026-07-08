# UX: worktree reconcile missing agent is raw required option before name errors

## Summary

worktree reconcile without args hits required option --agent before missing name, similar to spawn mode-before-agent ordering issue.

## Evidence

worktree reconcile --help requires name and --agent.
Missing both → required option --agent first (Commander).

## Why it matters

Wrong recovery order for multi-missing inputs.

## Suggested direction

Validate name and agent together; design-system error listing both.

## Severity

Low–Medium

## Area

Worktree

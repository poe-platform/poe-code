# UX: pipeline run --help omits --yes and --mode

## Summary

pipeline run help has agent/model/tui/archive/task/plan/max-runs/worktree — no --yes, --mode, dry-run notes for non-TTY CI.

## Evidence

pipeline run Options: no --yes, no --mode

## Why it matters

CI pipeline runs need documented non-TTY flags.

## Suggested direction

Document --yes; mode if applicable; non-TTY contract.

## Severity

**High**

## Area

Pipeline

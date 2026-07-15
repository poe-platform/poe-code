---
severity: low-medium
impact: usability
comment: "Keep of this trio as the one with the distinct insight: --agent is demanded before the missing name, so users discover requirements one failure at a time - the same ordering problem as ux-memory-write-requires-reason-before-path.md, ux-skill-install-file-required-before-name.md and ux-maestro-tick-missing-transition-raw-commander.md. Four commands, one fix: collect and report all missing required inputs together. That generalisation is worth more than the individual filings."
---

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

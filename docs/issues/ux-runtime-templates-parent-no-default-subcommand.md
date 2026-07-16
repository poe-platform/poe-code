---
severity: low-medium
impact: polish
reproduced: n
recommendation: no-fix
evidence: "npm run dev -- runtime templates prints one Usage block (grep -c 'Usage:' = 1), exit 1; src/cli/commands/runtime/templates/index.ts:9-18 registers group with no action and no duplicate help call; remaining 'default to ls' ask duplicates ux-many-parent-groups-only-dump-help.md"
comment: "Two findings and the first is a real bug rather than a preference: help prints twice, the same double-render as ux-models-endpoint-bogus-double-error-and-stack.md and ux-code-review-drafts-missing-arg-double-error.md - worth checking whether all three share a handler. The 'default to ls' half belongs to the bare-group family (ux-many-parent-groups-only-dump-help.md). Split them; the duplicate output is cheaper and more obviously wrong."
---

# UX: runtime templates parent shows help only twice

## Summary

runtime templates without subcommand prints help twice (Usage block duplicated) instead of defaulting to ls.

## Evidence

runtime templates → help text printed twice with ls/clear commands

## Why it matters

Parent group should default to ls or single help.

## Suggested direction

Default to templates ls; single help frame.

## Severity

Low–Medium

## Area

Runtime

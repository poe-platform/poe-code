---
severity: high
impact: usability
comment: "Keep of this pair. Same unbounded-history defect as runtime jobs ls, and its own comparison says so - which argues for one fix across both (default window, --all, age column) rather than two. Its 'no prune UX until clear' point is the sharper one: the only remedy is the all-or-nothing clear whose own guard is missing (ux-runtime-templates-clear-no-yes-or-dry-run.md), so users choose between an unusable list and a blunt wipe."
---

# UX: runtime templates ls is unbounded with May-era e2b entries

## Summary

runtime templates ls shows many e2b template cache rows from 2026-05-04 with no --limit — same unbounded history class as runtime jobs ls.

## Evidence

templates ls → many e2b rows dated May 2026.

## Why it matters

Unusable cache inventory; no prune UX until clear.

## Suggested direction

Default recent N; --all; age column; prune command.

## Severity

**High**

## Area

Runtime

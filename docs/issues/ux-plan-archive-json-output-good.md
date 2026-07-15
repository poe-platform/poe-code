---
severity: low
impact: none
comment: "Positive pattern with real value: the JSON result names the action, source path and archived path - a good machine contract for a destructive operation, since the caller can verify and undo. Cite it from ux-pipeline-validate-no-json-flag.md as proof the convention exists in this command group. Its own parenthetical is a reminder that even the positive probes here mutated real plans and needed git restore."
---

# UX: plan archive --output json is clean machine shape (positive)

## Summary

plan archive path --yes --output json returns action/path/archivedPath JSON — good machine contract (destructive; restore after audit).

## Evidence

{"action":"archive","path":"…","archivedPath":"…/archive/…"}

## Why it matters

Positive JSON destructive result shape.

## Suggested direction

Keep; document --yes requirement.

## Severity

Low

## Area

Plan / positive pattern

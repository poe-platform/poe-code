---
severity: low
impact: none
comment: "Keep of this positive pair (covers --since, --source and --limit composing). Its value is as the reference for the bounded-output work: traces already demonstrates the full filter set that models and runtime jobs ls lack, so those fixes have a working in-product model to copy rather than a design to invent."
---

# UX: traces --since and --source with --limit work (positive)

## Summary

traces --since 1d --limit 5 and traces --source claude --limit 2 return filtered tables — --since/--source/--limit compose well on traces.

## Evidence

--since 1d --limit 5 → 5 rows; --source claude --limit 2 → 2 claude rows.

## Why it matters

Positive traces filter composition; models should copy --limit.

## Suggested direction

Keep; apply --limit to models and runtime jobs ls.

## Severity

Low

## Area

Traces / positive pattern

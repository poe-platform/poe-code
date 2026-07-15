---
severity: low
impact: none
comment: "Positive pattern; duplicate of ux-harness-new-run-coverage-demo-works.md - consolidate. Its detail that the run reports '0 spawns' is mildly important: the demo completes without invoking an agent, so this positive proves the harness plumbing works but does not exercise a real spawn. State that plainly rather than implying broader coverage."
---

# UX: harness run coverage-demo scaffold works (positive)

## Summary

harness new coverage-demo + harness run succeeds with Result object summary and 0 spawns — demo path works when kind known.

## Evidence

Created harness pair; Ran probe2.md; Result: object · kind, version, …

## Why it matters

Positive harness scaffold+run.

## Suggested direction

Keep; document kinds.

## Severity

Low

## Area

Harness / positive pattern

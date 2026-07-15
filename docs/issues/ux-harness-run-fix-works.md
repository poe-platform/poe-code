---
severity: low
impact: none
comment: "Positive pattern and the weakest of the harness positives: it confirms --fix returns a Result object on a demo that performs no spawns, which does not establish that --fix actually does anything. Consolidate into the coverage-demo positive and do not cite it as evidence the fix path works."
---

# UX: harness run --fix works on coverage-demo (positive)

## Summary

harness run … --fix --yes succeeds with Result object — fix path works for demo.

## Evidence

Ran p3.md; Result: object · kind, version, …

## Why it matters

Positive --fix path.

## Suggested direction

Keep; document kinds.

## Severity

Low

## Area

Harness / positive pattern

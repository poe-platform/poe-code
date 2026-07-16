---
severity: low
impact: none
comment: "Positive pattern and the weakest of the harness positives: it confirms --fix returns a Result object on a demo that performs no spawns, which does not establish that --fix actually does anything. Consolidate into the coverage-demo positive and do not cite it as evidence the fix path works."
reproduced: n
recommendation: no-fix
evidence: "Positive note, no defect claimed; --fix option registered at src/cli/commands/harness.ts:81 and handled in packages/safejs/src/cli.ts:169"
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

---
severity: low
impact: none
comment: "Positive pattern; duplicate of ux-harness-run-coverage-demo-works.md (same new+run end-to-end check, same kind). Consolidate. Worth keeping in the survivor: the end-to-end path works once the kind is known, which isolates the harness problem to discoverability rather than function."
reproduced: n
recommendation: no-fix
evidence: "Positive/no-defect note, no bug to reproduce; src/cli/commands/harness.ts:78 (run) and :99 (new) plus packages/agent-harness/src/templates/index.ts:12 (coverage-demo) confirm the working path; duplicate of ux-harness-run-coverage-demo-works.md"
---

# UX: harness new+run coverage-demo works (positive)

## Summary

harness new coverage-demo + harness run succeeds with Result object — end-to-end harness path works.

## Evidence

Created harness pair; Ran ux-probe.md; Result: object … Usage: 0 spawns

## Why it matters

Positive harness path.

## Suggested direction

Keep; document kinds on help.

## Severity

Low

## Area

Harness / positive pattern

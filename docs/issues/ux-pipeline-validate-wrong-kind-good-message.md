---
severity: low
impact: none
comment: "The most useful positive in the pipeline set because of the contrast it draws: pipeline validate says 'Invalid plan YAML: \"kind\" must be \"pipeline\"' for a wrong-kind file while experiment validate says 'Experiment doc not found' for the same file (ux-experiment-validate-wrong-kind-says-not-found.md). Same situation, one correct diagnosis and one misdiagnosis - proving the kind-aware message is achievable and should be the template. Keep and link from the experiment/ralph wrong-kind cluster."
---

# UX: pipeline validate wrong kind message is good (positive)

## Summary

pipeline validate on plan-kind file: Invalid plan YAML: "kind" must be "pipeline" — clear kind check (still See logs + Problems lifecycle).

## Evidence

```bash
$ poe-code pipeline validate docs/plans/32-agent-goal.md
■  Error: Invalid plan YAML: "kind" must be "pipeline".
```
Contrast experiment validate: Experiment doc not found for same file.

## Why it matters

Positive kind error for pipeline; experiment should match this quality.

## Suggested direction

Use same kind-mismatch pattern for experiment/ralph/superintendent.

## Severity

Low

## Area

Pipeline / positive pattern

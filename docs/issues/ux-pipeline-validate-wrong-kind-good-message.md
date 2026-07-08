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

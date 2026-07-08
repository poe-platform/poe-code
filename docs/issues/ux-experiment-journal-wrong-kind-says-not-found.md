# UX: experiment journal on plan-kind doc says Experiment doc not found

## Summary

experiment journal docs/plans/32-agent-goal.md (kind: plan) says Experiment doc not found rather than wrong kind / expected experiment frontmatter.

## Evidence

```bash
$ poe-code experiment journal docs/plans/32-agent-goal.md
■  Experiment doc not found: docs/plans/32-agent-goal.md
```
File exists; kind is plan not experiment.

## Why it matters

Wrong-kind should not look like missing file (same class as ralph wrong-kind).

## Suggested direction

ValidationError: expected kind experiment, found plan.

## Severity

**High**

## Area

Experiment

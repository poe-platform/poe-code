# UX: experiment validate on non-experiment plan says not found (reconfirm class)

## Summary

experiment validate on agent-goal plan and pipeline plan both: Experiment doc not found — wrong kind, not missing file (files exist).

## Evidence

```bash
$ poe-code experiment validate docs/plans/32-agent-goal.md
■  Experiment doc not found: docs/plans/32-agent-goal.md
```
File exists; kind is plan not experiment.

## Why it matters

Kind-aware errors still missing for experiment path.

## Suggested direction

This path is plan kind, not experiment. Use experiment plan or convert.

## Severity

**High**

## Area

Experiment / kind errors

---
severity: high
impact: usability
comment: "Duplicate of ux-experiment-journal-wrong-kind-says-not-found.md on validate rather than journal; merge. Its added coverage is worth keeping: both an agent-goal plan and a pipeline plan produce the same false 'not found', so the defect sits in shared kind resolution rather than one command's error path."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/experiment.ts:645 bare catch in readExperimentDoc turns parseExperimentFrontmatter kind errors (frontmatter.ts:362-366 'Experiment document kind must be experiment') into 'Experiment doc not found'; validate uses readExperimentDoc at experiment.ts:1051 and docs/plans/32-agent-goal.md has kind: plan"
---

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

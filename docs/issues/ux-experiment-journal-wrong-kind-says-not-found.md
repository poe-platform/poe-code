---
severity: high
impact: usability
comment: "Valid and distinct from the empty-message cluster: this is the wrong-kind case, where a file that exists is reported as not found because its frontmatter kind is plan rather than experiment. 'Not found' for an existing file is a misdiagnosis that sends users hunting a path problem. Merge with ux-experiment-validate-wrong-kind-says-not-found.md and ux-experiment-journal-wrong-doc-type-message.md; same family as the ralph wrong-kind filings. One rule: distinguish missing from wrong-kind and name the kind found."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/experiment.ts:638-646 wraps readFile and parseExperimentFrontmatter in one try/catch, so the kind error from packages/experiment-loop/src/frontmatter/frontmatter.ts:362-365 ('Experiment document kind must be experiment') is swallowed and rethrown as 'Experiment doc not found'; journal calls it at experiment.ts:909; probe 'npm run dev -- experiment journal docs/plans/32-agent-goal.md' printed 'Experiment doc not found: docs/plans/32-agent-goal.md' though the file exists with kind: plan."
---

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

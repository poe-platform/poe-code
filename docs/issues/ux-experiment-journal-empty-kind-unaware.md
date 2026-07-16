---
severity: high
impact: usability
comment: "One of five filings of the same kind-unaware empty message across experiment journal/run/validate and ralph run; consolidate into ux-experiment-ralph-no-doc-wrong-message.md, which covers the widest surface. Shared defect: the filter is kind-specific but the message claims no markdown exists at all, which is simply false when docs/plans is full."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/experiment.ts:601 throws 'No markdown doc found under <planDirectory>' while discovery filters kinds; packages/experiment-loop/src/discovery/discovery.ts:33 passes kinds ['experiment'] and packages/agent-harness-tools/src/plans.ts:159 filters by frontmatter kind, so non-experiment markdown is excluded; duplicate of ux-experiment-ralph-no-doc-wrong-message.md"
---

# UX: experiment journal empty says no markdown under docs/plans

## Summary

experiment journal: No markdown doc found under docs/plans — same kind-unaware empty message as experiment run despite many plan files.

## Evidence

No markdown doc found under docs/plans. Provide a doc path.

## Why it matters

Reconfirm kind-aware experiment doc discovery.

## Suggested direction

No experiment journal docs found (kind=experiment).

## Severity

**High**

## Area

Experiment

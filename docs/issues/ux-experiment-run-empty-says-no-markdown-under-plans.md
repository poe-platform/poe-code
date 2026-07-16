---
severity: high
impact: usability
comment: "Duplicate within the kind-unaware cluster (experiment run rather than journal); retire into ux-experiment-ralph-no-doc-wrong-message.md. Its suggested wording - naming 'kind=experiment' explicitly in the message - is the clearest in the cluster and should survive."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/experiment.ts:601 throws 'No markdown doc found under ${planDirectory}' while packages/experiment-loop/src/discovery/discovery.ts:33 filters kinds: [experiment]; duplicate of ux-experiment-ralph-no-doc-wrong-message.md"
---

# UX: experiment run empty says no markdown under docs/plans

## Summary

experiment run --yes: No markdown doc found under docs/plans. Provide a doc path — but docs/plans has many plans; means no experiment-kind docs, message is kind-unaware.

## Evidence

No markdown doc found under docs/plans. Provide a doc path.
# docs/plans has plan-kind files

## Why it matters

Users think plans dir empty when experiment kinds missing.

## Suggested direction

No experiment docs found under docs/plans (kind=experiment).

## Severity

**High**

## Area

Experiment

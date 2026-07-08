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

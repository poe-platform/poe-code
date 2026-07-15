---
severity: medium
impact: usability
comment: "Duplicate within the eval empty-source cluster; retire into ux-eval-empty-source-message-inconsistent-skins.md. Its suggested replacement ('No evals found. Run eval init <name>.') is the best-worded recovery in the cluster and should be the text that survives."
---

# UX: eval report empty source uses --debug stack tease

## Summary

eval report with no evals: does not contain any first-level eval.yaml. Use --debug for a stack trace.

## Evidence

Eval source … does not contain any first-level <id>/eval.yaml files. Use --debug for a stack trace.

## Why it matters

Empty state should not suggest stacks.

## Suggested direction

No evals found. Run eval init <name>.

## Severity

Medium

## Area

Eval

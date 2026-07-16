---
severity: medium
impact: usability
comment: "Duplicate within the eval empty-source cluster; retire into ux-eval-empty-source-message-inconsistent-skins.md. Its suggested replacement ('No evals found. Run eval init <name>.') is the best-worded recovery in the cluster and should be the text that survives."
reproduced: y
recommendation: no-fix
evidence: "packages/agent-eval/src/source/open.ts:40 throws a plain Error (not UserError), so toolcraft/src/cli.ts:4144 appends the tease; probe 'npm run dev -- eval report --cwd /tmp/empty-eval-probe' printed: Eval source ... does not contain any first-level <id>/eval.yaml files. Use --debug for a stack trace."
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

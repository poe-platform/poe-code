---
severity: high
impact: correctness
reproduced: y
recommendation: fix
evidence: "packages/pipeline/src/plan/discovery.ts:187-190 returns candidates[0] when assumeYes and no explicit plan; src/cli/commands/pipeline.ts:295 throws 'Task \"x\" was not found in the plan.' without listing valid task ids"
comment: "Correctly High and part of the most important safety pattern in the audit: --task without --plan silently selects some plan, so the command acts on an object the user never named. Same defect as ux-gaslight-no-plan-autopicks-and-hits-stale-model.md and ux-plan-archive-delete-yes-picks-arbitrary-plan.md - autopicking under --yes. One rule closes all three: never infer the target of an action; require it explicitly and list candidates on failure. Its secondary ask (list valid task ids) is the recovery the error should carry."
---

# UX: pipeline run --task without --plan auto-picks plan

## Summary

--task foo --yes picks some plan, shows 21/21 done, then task not found.

## Evidence

pipeline run --task foo --yes.

## Why it matters

Wrong-plan execution risk.

## Suggested direction

Require --plan with --task; list task ids.

## Severity

**High**

## Area

Pipeline

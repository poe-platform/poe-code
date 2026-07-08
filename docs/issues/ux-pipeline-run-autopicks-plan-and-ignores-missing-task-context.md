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

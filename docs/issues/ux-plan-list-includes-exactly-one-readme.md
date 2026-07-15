---
severity: medium
impact: correctness
comment: "One of five filings that README.md appears in plan list, this one via --output json; consolidate. The underlying defect is real and slightly worse than 'noise': README is classified as a plan by discovery, which is the same error that makes ux-plan-archive-allows-readme.md and ux-plan-delete-allows-readme.md dangerous - if README is a plan, it is archivable and deletable. Fix the classification once and all five plus the two destructive filings improve."
---

# UX: plan list includes exactly one README.md among 11 entries (reconfirmed)

## Summary

plan list --output json has 11 plans including 1 README.md — reconfirm noise file in list.

## Evidence

11 plans; 1 named README.md.

## Why it matters

Reconfirm filter README out of plan list.

## Suggested direction

Exclude README.md and non-plan docs.

## Severity

Medium

## Area

Plan list

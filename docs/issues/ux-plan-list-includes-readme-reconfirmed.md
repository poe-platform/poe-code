---
severity: medium
impact: correctness
comment: "Keep as canonical of the README-in-plan-list quintet (terminal output; the json/md variants are the same defect through different renderers). The fix belongs in plan discovery rather than per output mode: define what makes a file a plan (frontmatter kind, presumably) and exclude everything else. That single change also removes the destructive exposure in ux-plan-archive-allows-readme.md."
---

# UX: plan list includes README.md (reconfirmed)

## Summary

plan list --kind plan shows README.md Active Plans among plans — reconfirm noise file in list.

## Evidence

plan list includes README.md row.

## Why it matters

Reconfirm filter README out of plan list.

## Suggested direction

Exclude README.md and non-plan docs.

## Severity

Medium

## Area

Plan list

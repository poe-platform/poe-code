---
severity: high
impact: correctness
comment: "Duplicate of ux-plan-archive-json-skips-without-explaining-why.md (same missing reason field on the sibling command); consolidate into one issue about the JSON skip contract. Its incidental finding is important and should survive: README is still present after the skip, evidence that README may be protected - directly relevant to the contradiction in ux-plan-delete-allows-readme.md."
---

# UX: plan delete --output json also skips with confirmationRequired only

## Summary

plan delete docs/plans/README.md --output json returns skipped:true without reason field — same opacity as archive JSON skip; README still present (good that delete skipped).

## Evidence

```json
{"action":"delete","path":"docs/plans/README.md","confirmationRequired":true,"skipped":true}
```

## Why it matters

Non-TTY scripts cannot know to pass --yes.

## Suggested direction

reason field; document --yes requirement for non-TTY destructive plan ops.

## Severity

**High**

## Area

Plan / destructive

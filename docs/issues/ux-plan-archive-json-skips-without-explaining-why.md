# UX: plan archive --output json can skip with confirmationRequired without human reason

## Summary

plan archive docs/plans/README.md --output json returns skipped:true, confirmationRequired:true without explaining why skipped (non-TTY confirmation?) or that README may be special.

## Evidence

```json
{"action":"archive","path":"docs/plans/README.md","confirmationRequired":true,"skipped":true}
```

## Why it matters

Machine and human users cannot tell if path was invalid, needs --yes, or blocked.

## Suggested direction

Include reason field: needs_confirmation | not_a_plan | already_archived; document --yes.

## Severity

**High**

## Area

Plan / destructive

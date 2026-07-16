---
severity: high
impact: polish
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/plan.ts:465-478 emits {confirmationRequired:true,skipped:true} with no reason field; but that field is the only skip cause - invalid paths throw ValidationError at plan.ts:320, and no README/already-archived protection exists, so the skip is unambiguous"
comment: "Good catch, correctly High: the JSON says skipped:true and confirmationRequired:true with no reason field, so neither a human nor a script can tell whether the path was invalid, needed --yes, was already archived, or is protected. For a machine contract on a destructive command, an unexplained skip is worse than an error. Its suggested reason enum is exactly right. It is also the best evidence on whether README is protected (ux-plan-archive-allows-readme.md) - the skip may be the protection."
---

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

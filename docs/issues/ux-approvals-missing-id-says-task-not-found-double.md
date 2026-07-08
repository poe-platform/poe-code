# UX: approvals show/run missing id says Task not found twice + --debug

## Summary

approvals show|run --approval-id missing: Task "approvals/missing" not found. Use --debug for a stack trace — twice; wrong noun (Task vs Approval); invites --debug stacks; npm run dev on help.

## Evidence

```bash
$ poe-code approvals show --approval-id missing
■  Task "approvals/missing" not found. Use --debug for a stack trace.
■  Task "approvals/missing" not found. Use --debug for a stack trace.
```

## Why it matters

Approval not found should not say Task or invite stack dumps.

## Suggested direction

Approval not found: missing. Try approvals list.

## Severity

**High**

## Area

Approvals

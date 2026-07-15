---
severity: high
impact: usability
comment: "Keep as canonical of the three approvals-not-found filings: only this one catches the duplicate emission, which is a separate defect from the wording and points at an error handler running twice. Three distinct problems are bundled here - (1) the message prints twice, (2) 'Task' is the wrong noun for an approval, (3) '--debug for a stack trace' invites stack dumps for a plain not-found. Split (1) out; it is a handler bug, not copy."
---

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

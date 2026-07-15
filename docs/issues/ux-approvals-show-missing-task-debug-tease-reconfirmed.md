---
severity: medium
impact: usability
comment: "Third duplicate of the approvals-not-found observation; retire into ux-approvals-missing-id-says-task-not-found-double.md. Note it is rated Medium while the other two are High for identical behavior - the cluster needs one severity, not three."
---

# UX: approvals show missing uses Task not found + --debug tease (reconfirmed)

## Summary

approvals show --approval-id missing: Task "approvals/missing" not found. Use --debug for a stack trace — reconfirm opaque task language + debug tease.

## Evidence

Task "approvals/missing" not found. Use --debug for a stack trace.

## Why it matters

Reconfirm ValidationError for missing approval.

## Suggested direction

Approval not found: missing. Run approvals list.

## Severity

Medium

## Area

Approvals

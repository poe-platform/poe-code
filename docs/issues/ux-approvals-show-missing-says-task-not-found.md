# UX: approvals show missing id says Task not found (wrong domain)

## Summary

approvals show --approval-id missing returns Task "approvals/missing" not found — task terminology for approvals domain; also toolcraft help identity.

## Evidence

```bash
$ poe-code approvals show --approval-id missing
■  Task "approvals/missing" not found. Use --debug for a stack trace.
```

## Why it matters

Wrong noun confuses approvals vs tasks systems.

## Suggested direction

Approval not found: missing; list with approvals list.

## Severity

**High**

## Area

Approvals

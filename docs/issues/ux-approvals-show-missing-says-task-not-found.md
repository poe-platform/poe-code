---
severity: high
impact: usability
comment: "Duplicate of ux-approvals-missing-id-says-task-not-found-double.md, which has the same string plus the double emission this one misses; retire into it. One detail worth carrying over: the 'Task' noun leaks because approvals are built on the task subsystem, so the fix is mapping task-layer errors to approval-domain copy at the boundary, not rewording a single string."
reproduced: y
recommendation: no-fix
evidence: "packages/toolcraft/src/human-in-loop/approvals-commands.ts:85 throws TaskNotFoundError with hardcoded 'Task \"approvals/${params.approvalId}\" not found.'; backend packages/task-list/src/backends/markdown-dir.ts:539 emits the same task-domain wording via tasks.get"
---

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

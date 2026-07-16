---
severity: medium
impact: correctness
comment: "Duplicate of ux-approvals-invalid-state-silent-empty-reconfirmed.md with thinner evidence; retire into it. No independent value beyond confirming the behavior a second time."
reproduced: y
recommendation: no-fix
evidence: "packages/toolcraft/src/human-in-loop/approvals-commands.ts:19-21 declares state as S.Optional(S.String()) with no enum; backends filter by equality only (packages/task-list/src/backends/markdown-dir.ts:962, yaml-file.ts:132), so an unknown state yields [] and renderApprovalList prints 'No approvals found.' (approvals-commands.ts:196-199). Behaviour is real but this doc duplicates the canonical reconfirmed report."
---

# UX: approvals bad --state empty

## Summary

nope looks empty queue.

## Evidence

approvals list --state nope.

## Why it matters

False empty.

## Suggested direction

Validate enum.

## Severity

Medium

## Area

Approvals

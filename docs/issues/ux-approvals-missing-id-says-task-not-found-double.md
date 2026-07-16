---
severity: high
impact: usability
comment: "Keep as canonical of the three approvals-not-found filings: only this one catches the duplicate emission, which is a separate defect from the wording and points at an error handler running twice. Three distinct problems are bundled here - (1) the message prints twice, (2) 'Task' is the wrong noun for an approval, (3) '--debug for a stack trace' invites stack dumps for a plain not-found. Split (1) out; it is a handler bug, not copy."
reproduced: y
recommendation: fix
evidence: "Wording defects confirmed: packages/toolcraft/src/human-in-loop/approvals-commands.ts:85 throws TaskNotFoundError('Task \"approvals/<id>\" not found.'); TaskNotFoundError is not a UserError so it falls to the fallback branch at packages/toolcraft/src/cli.ts:4144 which appends 'Use --debug for a stack trace.'. Double-emission claim NOT reproduced: 'npm run dev -- approvals show --approval-id missing' and 'approvals run --approval-id missing' each print the line exactly once (grep -c = 1, stdout only, stderr 0); the filing's two-line block is show and run pasted together, so the canonical rationale in comment is void."
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

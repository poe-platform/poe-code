---
severity: medium
impact: usability
comment: "Distinct from the double-error cluster and valid: 'no draft found for URL' is an expected empty state, so offering a stack trace is wrong twice over - it implies a crash and it sends users somewhere useless. Same '--debug tease on a not-found' pattern as ux-approvals-missing-id-says-task-not-found-double.md and ux-superintendent-complete-wrong-kind-debug-tease.md; make it a central rule (never offer --debug for an expected not-found) rather than fixing per command."
---

# UX: code-review drafts not found uses --debug stack tease

## Summary

No active code review draft found for URL. Use --debug for a stack trace — not-found should not suggest debug stacks.

## Evidence

```bash
$ poe-code code-review drafts "https://github.com/owner/repo/pull/1"
■  No active code review draft found for …. Use --debug for a stack trace.
```

## Why it matters

Debug tease on empty state.

## Suggested direction

ValidationError; suggest run code-review first.

## Severity

Medium

## Area

Code-review

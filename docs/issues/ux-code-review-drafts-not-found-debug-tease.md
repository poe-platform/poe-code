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

---
severity: medium
impact: usability
comment: "Duplicate of ux-code-review-drafts-missing-arg-double-error.md - same command, same double error, same npm run dev line; retire into it. Rated Medium against that file's High for identical output; normalise."
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- code-review drafts prints 'error: missing required argument prUrl' twice plus 'Run npm run dev -- code-review drafts --help for usage.'; raw Commander write from exitOverride false at src/cli/bootstrap.ts:47 and npm run dev prefix at src/utils/execution-context.ts:203. Duplicate: canonical ux-code-review-drafts-missing-arg-double-error.md absorbs this file."
---

# UX: code-review drafts missing prUrl double error + npm run dev

## Summary

code-review drafts without prUrl: missing required argument prUrl twice + npm run dev recovery — same class as code-review run.

## Evidence

error: missing required argument 'prUrl'
■  error: missing required argument 'prUrl'
Run npm run dev -- code-review drafts --help

## Why it matters

Double error + identity leak.

## Suggested direction

Single ValidationError; poe-code recovery.

## Severity

Medium

## Area

Code-review / identity

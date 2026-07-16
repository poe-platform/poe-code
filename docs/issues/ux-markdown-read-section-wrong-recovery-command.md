---
severity: high
impact: usability
comment: "Small but genuinely bad and correctly High: the recovery hint names 'read-markdown', a command that does not exist - the real one is 'plan markdown-read' - so the one line meant to unblock the user routes them into an Unknown command error, compounded by the missing did-you-mean (ux-command-not-found-no-suggestions.md). A wrong recovery is worse than none. Trivial fix, high embarrassment value; the 'See logs' half belongs to the systemic UserError issue."
reproduced: y
recommendation: fix
evidence: "packages/markdown-reader/src/core/resolve.ts:35 emits \"try 'read-markdown'\" while src/cli/commands/plan.ts:655 registers command 'markdown-read'; MCP tools are 'read'/'read-section' (mcp/tools.ts:24,46)"
---

# UX: markdown-read-section miss suggests read-markdown not markdown-read

## Summary

markdown-read-section no-such-section: try read-markdown to see TOC — wrong command name (actual is plan markdown-read).

## Evidence

no section matching "no-such-section" (try 'read-markdown' to see the table of contents)
●  See logs …

## Why it matters

Wrong recovery command; See logs on ValidationError.

## Suggested direction

suggest: poe-code plan markdown-read <file>; UserError.

## Severity

**High**

## Area

Plan

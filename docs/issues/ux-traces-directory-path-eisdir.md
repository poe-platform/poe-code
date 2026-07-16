---
severity: medium
impact: usability
comment: "Contentless duplicate within the traces fs-error cluster; retire. Its 'detect directory' instinct is the whole fix in two words."
reproduced: y
recommendation: no-fix
evidence: "loader.ts:326 readFile(path) with no stat check; `npm run dev -- traces /tmp` prints 'Error: EISDIR: illegal operation on a directory, read'. Duplicate of ux-traces-enoent-eisdir-still-system-errors.md"
---

# UX: traces directory EISDIR

## Summary

traces docs EISDIR.

## Evidence

traces docs.

## Why it matters

Folder path confusion.

## Suggested direction

Detect directory.

## Severity

Medium

## Area

Traces

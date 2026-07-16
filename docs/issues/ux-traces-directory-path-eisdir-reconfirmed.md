---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "packages/agent-trace-viewer/src/loader.ts:326 loadTraceFromFile calls fs.readFile(path) with no stat/isDirectory guard, so a directory path raises raw EISDIR; duplicate of docs/issues/ux-traces-enoent-eisdir-still-system-errors.md"
comment: "One of four filings of raw fs errors from traces; consolidate into ux-traces-enoent-eisdir-still-system-errors.md, which covers both ENOENT and EISDIR. Its suggested wording is the best of the group and should survive: 'Path is a directory. Pass a trace file or use --source' names the mistake and both ways forward."
---

# UX: traces directory path is EISDIR system error (reconfirmed)

## Summary

traces /tmp → EISDIR illegal operation on directory, read + See logs — reconfirm kind-aware path error.

## Evidence

EISDIR: illegal operation on a directory, read

## Why it matters

Reconfirm UserError for directories.

## Suggested direction

Path is a directory. Pass a trace file or use --source.

## Severity

Medium

## Area

Traces

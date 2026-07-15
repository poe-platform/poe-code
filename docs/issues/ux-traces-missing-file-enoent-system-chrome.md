---
severity: medium
impact: usability
comment: "Duplicate within the traces fs-error cluster; retire into ux-traces-enoent-eisdir-still-system-errors.md."
---

# UX: traces missing file is ENOENT system chrome

## Summary

traces /tmp/no-trace.jsonl → ENOENT open + See logs.

## Evidence

ENOENT: no such file or directory, open '/tmp/no-trace.jsonl' 

## Why it matters

UserError without logs.

## Suggested direction

Trace file not found: path.

## Severity

Medium

## Area

Traces

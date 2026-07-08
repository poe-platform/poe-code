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

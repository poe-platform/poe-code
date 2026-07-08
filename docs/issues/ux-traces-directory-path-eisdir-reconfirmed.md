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

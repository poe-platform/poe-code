# UX: memory append --reason defaults to append (positive-ish)

## Summary

memory append --help: --reason default append — unlike write which requires reason; append has default so non-TTY easier.

## Evidence

--reason <text> Reason for the memory update (default: "append")

## Why it matters

Positive default for append; write still requires reason (raw commander).

## Suggested direction

Keep append default; write should ValidationError not raw commander.

## Severity

Low

## Area

Memory / positive pattern

---
severity: low
impact: none
comment: "Positive with a useful comparison rather than a defect: --reason defaults on append and is required on write, which is defensible (an append is self-describing, a write is not) but undocumented as deliberate. Its real contribution is the pointer that write's requirement surfaces as a raw Commander error - that belongs with ux-raw-commander-missing-args.md. Keep as the note that append's default is correct."
---

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

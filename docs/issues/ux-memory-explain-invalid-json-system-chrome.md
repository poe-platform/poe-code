# UX: memory explain fails with invalid JSON agent output + See logs

## Summary

memory explain pages/hello.md: Memory agent returned invalid JSON output + See logs — agent failure unframed.

## Evidence

■  Error: Memory agent returned invalid JSON output.
●  See logs …

## Why it matters

Explain should degrade gracefully or UserError with retry.

## Suggested direction

UserError; optional --model; no See logs.

## Severity

**High**

## Area

Memory

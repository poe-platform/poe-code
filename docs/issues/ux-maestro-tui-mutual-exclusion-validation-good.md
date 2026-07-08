# UX: maestro tui mutual exclusion of config/workflow is good (positive)

## Summary

Specifying both --config and --workflow fails with clear mutual exclusion message.

## Evidence

```bash
$ poe-code maestro tui --config a --workflow b
■  Specify only one of --config or --workflow for Maestro TUI.
```

## Why it matters

Positive validation pattern.

## Suggested direction

Keep; reduce to one flag long-term.

## Severity

Low

## Area

Maestro / positive pattern

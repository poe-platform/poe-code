# UX: maestro tui has both --config and --workflow for same path

## Summary

maestro tui accepts --config and --workflow for WORKFLOW.md and errors if both set — duplicate flags for one concept; root maestro may not accept --config the same way.

## Evidence

```bash
$ poe-code maestro tui --config ./no.md --workflow ./no2.md
■  Specify only one of --config or --workflow for Maestro TUI.
$ poe-code maestro --config ./no.md
error: unknown option '--config'
```
tui help lists both --config and --workflow as Path to WORKFLOW.md.

## Why it matters

Duplicate flags confuse; root vs tui flag surface differs.

## Suggested direction

Single --config (or --workflow) everywhere; alias the other.

## Severity

Medium

## Area

Maestro

# UX: traces --cwd-only is unknown despite earlier help documenting it

## Summary

traces --cwd-only now errors unknown option, while earlier audit capture listed --cwd-only / --all-workspaces on traces help — flag drift or help/implementation mismatch.

## Evidence

```bash
$ poe-code traces --cwd-only --limit 3
error: unknown option '--cwd-only'
```
Current traces --help should be checked for workspace filters.

## Why it matters

Users following old help or muscle memory fail; document current filters.

## Suggested direction

Restore flag or document replacement; keep help/implementation in sync.

## Severity

Medium

## Area

Traces

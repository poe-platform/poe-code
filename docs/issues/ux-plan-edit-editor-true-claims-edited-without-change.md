# UX: plan edit with EDITOR=true claims Edited without real edit

## Summary

EDITOR=true plan edit reports Edited path even when true is a no-op binary — success without change detection.

## Evidence

```bash
$ EDITOR=true poe-code plan edit docs/plans/32-agent-goal.md
Edited docs/plans/32-agent-goal.md
```

## Why it matters

False success if editor fails or is a stub.

## Suggested direction

Detect mtime/content change; report No changes if unchanged; validate EDITOR is usable.

## Severity

Medium

## Area

Plan / editor

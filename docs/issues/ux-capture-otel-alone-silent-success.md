# UX: --capture-otel alone succeeds without indicating capture state

## Summary

spawn --capture-otel succeeds without confirming otel capture started or where data went — silent success for advanced flag.

## Evidence

```bash
$ poe-code spawn … --capture-otel
# success, no otel mention
```

## Why it matters

Users cannot verify capture is active.

## Suggested direction

Print OTEL capture enabled → path/endpoint when flag set.

## Severity

Medium

## Area

Spawn / otel

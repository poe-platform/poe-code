---
severity: medium
impact: usability
comment: "Keep as canonical of this pair (clearer repro; ux-capture-otel-no-visible-output-change.md is the twin). The concern is more than presentation: with no confirmation and no destination printed, users cannot distinguish 'capture worked' from 'flag silently no-oped' - the same ambiguity ux-capture-otel-content-without-capture-silent.md exposes from the other side. Printing the endpoint or path on enable resolves all three files."
---

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

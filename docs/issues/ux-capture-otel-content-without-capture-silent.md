# UX: --capture-otel-content without --capture-otel is silently accepted

## Summary

spawn with --capture-otel-content alone succeeds without enabling otel capture or warning that --capture-otel is required.

## Evidence

```bash
$ poe-code spawn … --capture-otel-content
# succeeds; no otel mention
```

## Why it matters

Content flag implies capture is on; silent no-op misleads.

## Suggested direction

Require --capture-otel when --capture-otel-content set; or imply it.

## Severity

Medium

## Area

Spawn / flags

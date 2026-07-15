---
severity: medium
impact: correctness
comment: "The most serious of the three otel files and genuinely distinct: --capture-otel-content without --capture-otel is accepted and does nothing, so the user believes content capture is on when no capture is running at all. This is a flag-dependency validation bug, not an output bug - do not merge it into the two 'no confirmation' files. Fix by erroring on the unsatisfied dependency or implying --capture-otel; the confirmation line asked for in the siblings then makes the outcome verifiable."
---

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

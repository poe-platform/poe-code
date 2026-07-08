# UX: spawn --yes defaults to yolo mode (help says so; verify awareness)

## Summary

spawn --yes without --mode runs successfully (uses yolo per help). Help documents --yes uses yolo — good if users read it; risky default for CI scripts that pass --yes habitually.

## Evidence

```bash
$ poe-code spawn claude "say only: ok" --yes --model haiku
# succeeds (yolo)
# help: --mode … (prompted; --yes uses yolo)
```

## Why it matters

--yes as "accept defaults" also means max permissions — footgun.

## Suggested direction

Require explicit --mode in non-TTY even with --yes; or default --yes to read/auto with warning.

## Severity

**High**

## Area

Spawn / safety

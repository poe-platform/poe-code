# UX: --runner-sync without --runtime/--detach is silently accepted

## Summary

spawn with --runner-sync both but no runtime/detach runs inline successfully — flag appears no-op without warning.

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read --model haiku --runner-sync both
# succeeds inline
```

## Why it matters

Similar to --detach without runtime.

## Suggested direction

Warn or error if runner-sync set without remote runtime.

## Severity

Medium

## Area

Spawn / runtime

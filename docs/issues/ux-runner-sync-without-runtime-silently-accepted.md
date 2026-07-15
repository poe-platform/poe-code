---
severity: medium
impact: correctness
comment: "Duplicate of ux-runner-sync-without-detach-silently-ignored.md; retire into it. Rated Medium against that file's High for identical behavior; normalise. Its own note that this is 'similar to --detach without runtime' is the useful observation - these should be one flag-dependency issue rather than four."
---

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

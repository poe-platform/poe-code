# UX: spawn --interactive non-TTY still runs non-interactively

## Summary

spawn … --interactive without TTY still produces agent output (not a clear "requires TTY" failure) — flag ignored or partially applied.

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read --model haiku --interactive
# still gets agent text response in non-TTY
```

## Why it matters

--interactive should require TTY or fail clearly.

## Suggested direction

Error if --interactive && !TTY; or strip flag with warning.

## Severity

Medium

## Area

Spawn / interactive

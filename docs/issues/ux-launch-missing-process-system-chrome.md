# UX: launch logs/restart missing process uses system chrome

## Summary

Managed process "missing" was not found + See logs for launch logs/restart.

## Evidence

```bash
$ poe-code launch logs missing
■  Error: Managed process "missing" was not found.
●  See logs …
```

## Why it matters

Not-found should suggest launch status; no logs.

## Suggested direction

ValidationError + launch status hint.

## Severity

Medium

## Area

Launch

# UX: utils config edit missing $EDITOR uses system chrome

## Summary

utils config edit without EDITOR says Set $EDITOR to use this command + See logs — good message, unnecessary logs (plan edit may hang instead).

## Evidence

```bash
$ env -u EDITOR poe-code utils config edit --global
■  Error: Set $EDITOR to use this command
●  See logs …
```

## Why it matters

Align editor errors; no logs for ValidationError.

## Suggested direction

ValidationError without logs; same for plan edit.

## Severity

Medium

## Area

Utils / editor

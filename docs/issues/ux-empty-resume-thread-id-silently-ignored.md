# UX: empty --resume-thread-id is silently ignored

## Summary

spawn … --resume-thread-id "" succeeds as a fresh session — empty resume id not rejected (related empty-model-flag inconsistency).

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read --model haiku --resume-thread-id ""
# succeeds without resume error
```

## Why it matters

Explicit empty flags should error when present.

## Suggested direction

Reject empty --resume-thread-id when flag present.

## Severity

Medium

## Area

Spawn / flags

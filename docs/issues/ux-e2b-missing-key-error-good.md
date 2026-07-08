# UX: E2B missing API key error is good (positive)

## Summary

No E2B API key message points to E2B_API_KEY and config.json paths — good recovery (still See logs).

## Evidence

```bash
$ poe-code spawn … --runtime e2b
■  Error: No E2B API key. Set E2B_API_KEY or e2b.api_key in …config.json
```

## Why it matters

Positive recovery pattern.

## Suggested direction

Keep; drop See logs.

## Severity

Low

## Area

Spawn / positive pattern

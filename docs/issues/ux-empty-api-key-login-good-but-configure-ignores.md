# UX: login rejects empty API key; configure --api-key "" still proceeds

## Summary

login --api-key "" / " " correctly rejects POE API key cannot be empty. configure --api-key "" --yes --dry-run still plans configure (empty key ignored) — inconsistent empty-key handling.

## Evidence

```bash
$ poe-code login --api-key ""
■  POE API key cannot be empty.
$ poe-code configure --api-key "" --yes --dry-run
●  Dry run: would configure Claude Code.
```

## Why it matters

Explicit empty key on configure should error like login.

## Suggested direction

Reject empty --api-key everywhere when flag present.

## Severity

**High**

## Area

Auth / configure

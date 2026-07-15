---
severity: high
impact: correctness
comment: "Best filing of the empty --api-key family and the right canonical: it proves login already rejects an empty key with a clear message while configure silently proceeds, turning this from 'add validation' into 'apply the validation that already exists' - much cheaper, with an in-repo reference. Absorbs ux-empty-api-key-flag-silently-ignored.md and ux-empty-api-key-flag-still-silently-ignored.md. The same argument shape resolves ux-empty-model-flag-behavior-inconsistent.md."
---

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

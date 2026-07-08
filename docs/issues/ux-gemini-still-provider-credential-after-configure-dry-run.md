# UX: spawn gemini still fails providerCredential after configure dry-run only

## Summary

configure gemini --dry-run plans quiet success; spawn gemini still Cannot resolve providerCredential — reconfirm gemini needs real configure + provider login; dry-run does not help readiness.

## Evidence

```bash
$ poe-code configure gemini --yes --dry-run
●  Dry run: would configure Gemini CLI.
$ poe-code spawn gemini "ok" --mode read
■  Error: Cannot resolve "providerCredential": no active provider on context.
```

## Why it matters

Reconfirm opaque gemini credential error; dry-run does not validate readiness.

## Suggested direction

UserError with configure gemini + provider login cloudflare/poe steps.

## Severity

**High**

## Area

Spawn / gemini

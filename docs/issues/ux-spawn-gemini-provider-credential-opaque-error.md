# UX: spawn gemini fails with opaque "no active provider on context"

## Summary

spawn gemini with an explicit model can fail with Cannot resolve "providerCredential": no active provider on context — internal jargon without telling the user to configure gemini or login to a compatible provider.

## Evidence

```bash
$ poe-code spawn gemini "say only: ok" --mode read --model google/gemini-2.5-pro
■  Error: Cannot resolve "providerCredential": no active provider on context.
●  See logs …
```

## Why it matters

Looks like an internal crash; recovery is configure/login, not reading errors.log.

## Suggested direction

UserError: Gemini is not configured. Run poe-code configure gemini or pass provider credentials; map providerCredential errors.

## Severity

**High**

## Area

Spawn / gemini

# UX: spawn gemini fails providerCredential no active provider

## Summary

spawn gemini with google/gemini-2.5-flash: Cannot resolve "providerCredential": no active provider on context + See logs — even when poe logged in; test gemini fails GEMINI_API_KEY env missing.

## Evidence

```bash
$ poe-code spawn gemini "say only: ok" --mode read --model google/gemini-2.5-flash
■  Cannot resolve "providerCredential": no active provider on context.
$ poe-code test gemini
When using Gemini API, you must specify the GEMINI_API_KEY …
```

## Why it matters

Gemini path broken post-configure dry-run; users cannot spawn advertised agent.

## Suggested direction

Wire poe provider credential into gemini-cli; UserError configure recovery.

## Severity

**High**

## Area

Spawn / gemini

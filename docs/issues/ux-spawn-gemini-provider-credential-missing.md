---
severity: high
impact: usability
comment: "One of three filings of the gemini credential failure; consolidate. Its distinct and more serious claim is that gemini fails even while poe is logged in, and that test gemini demands GEMINI_API_KEY - suggesting gemini-cli is not wired to the poe provider at all rather than merely erroring badly. If so this is a capability gap, not a copy problem. Verify first; it changes the fix entirely."
---

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

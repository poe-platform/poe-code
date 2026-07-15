---
severity: high
impact: usability
comment: "Valid and nasty: configure gemini fails demanding a cloudflare base URL although the user never mentioned cloudflare, so the error names a provider drawn from residual or default state and the recovery points somewhere the user has no reason to go. Same misdiagnosis family as ux-code-review-run-invalid-url-wrong-error.md. Fix by defaulting to the poe provider when available and, when a provider does come from ambient state, saying where it came from."
---

# UX: configure gemini fails needing cloudflare base URL when logged out

## Summary

configure gemini --yes --dry-run: Provider cloudflare requires a base URL for API shape google-generations — opaque when user never chose cloudflare; may be residual project/default provider. Clearer: default provider poe or prompt for base URL.

## Evidence

Provider "cloudflare" requires a base URL for API shape "google-generations". Run provider login cloudflare --base-url…

## Why it matters

Gemini configure blocked by unrelated cloudflare default when not logged in to poe.

## Suggested direction

Default gemini to poe provider when available; clearer recovery.

## Severity

**High**

## Area

Configure / gemini

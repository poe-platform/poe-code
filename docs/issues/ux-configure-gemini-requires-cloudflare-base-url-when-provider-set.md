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

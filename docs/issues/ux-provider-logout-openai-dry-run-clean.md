---
severity: low
impact: none
comment: "Third filing of the credential-only logout dry-run positive (with anthropic); consolidate the set into one note. Its value is coverage - anthropic and openai both stay credential-scoped while poe floods, strengthening the case that ux-provider-logout-poe-dry-run-unconfigures-agents.md is a poe-specific coupling bug rather than intended behavior for the command."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/provider.ts:565-568 unconfigureServicesForProvider skips services whose metadata.provider !== providerId, so openai logout touches only its own credential when no openai-backed service is configured; positive note, no defect"
---

# UX: provider logout openai --dry-run is clean (positive)

## Summary

provider logout openai --dry-run only would log out + rm credentials.openai.enc — clean credential-only dry-run.

## Evidence

logout openai dry-run → rm credentials.openai.enc only.

## Why it matters

Positive pattern for provider logout.

## Suggested direction

Match poe logout dry-run to this style.

## Severity

Low

## Area

Providers / positive pattern

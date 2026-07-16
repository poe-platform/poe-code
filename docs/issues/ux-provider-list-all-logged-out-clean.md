---
severity: low
impact: none
comment: "Positive pattern and a useful boundary case for the secrets cluster: the logged-out provider list shows status without leaking anything, as ux-utils-config-show-logged-out-clean-no-secrets.md also confirms. Both are weak reassurance though - the leaks appear when credentials exist, so read these as 'clean when empty' rather than 'clean'."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/provider.ts:91 renders Status [-] via theme.muted when not logged in; line 92 Env uses formatProviderEnv (provider.ts:331-341) which emits only env var names, never values; row fields are limited to Provider/Status/Env/API shapes/Agents (provider.ts:88-95), so no credential material is printed. Positive note, no defect to fix."
---

# UX: provider list all logged out is clean (positive)

## Summary

provider list when not logged in shows all providers Status [-] without secrets — clean empty auth state.

## Evidence

poe/anthropic/openai/cloudflare all Status [-]

## Why it matters

Positive logged-out provider list.

## Suggested direction

Keep.

## Severity

Low

## Area

Providers / positive pattern

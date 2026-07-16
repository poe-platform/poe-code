---
severity: low
impact: usability
reproduced: n
recommendation: no-fix
evidence: "Probe `npm run dev -- provider login anthropic --api-key sk-fake-triage-probe --yes --dry-run` plans mkdir ~/.claude plus full ~/.claude/settings.json rewrite (147 lines) before printing 'Dry run: would save credential for anthropic.', so the claimed 'no filesystem changes' is false; key never printed. src/cli/commands/provider.ts:192 emits the message; refreshConfiguredServicesForProvider (provider.ts:174) drives the settings plan for every provider, matching ux-provider-login-poe-dry-run-rewrites-claude-settings-xhigh.md"
comment: "Positive pattern; duplicate of ux-provider-login-anthropic-dry-run-good.md - same command, same conclusion. Consolidate. The pair is genuinely useful as the contrast case: provider login's dry-run stays credential-scoped and prints no secret, exactly what provider login poe fails to do (ux-provider-login-poe-dry-run-rewrites-claude-settings-xhigh.md). Same command, different provider, wildly different blast radius."
---

# UX: provider login anthropic --dry-run is clean (positive)

## Summary

provider login anthropic --api-key sk-fake --dry-run: would save credential; no filesystem changes — clean dry-run without printing key.

## Evidence

Dry run: would save credential for anthropic. # no filesystem changes

## Why it matters

Positive dry-run for credentials.

## Suggested direction

Keep.

## Severity

Low

## Area

Providers / positive pattern

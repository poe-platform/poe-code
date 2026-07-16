---
severity: medium
impact: security
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/login.ts:32, auth.ts:47, configure.ts:75, agent.ts:23, provider.ts:54 all declare '--api-key <key>' with no history warning; 'npm run dev -- login --help' prints only '--api-key <key>  Poe API key' and never mentions POE_API_KEY"
comment: "Thin restatement of the --api-key argv exposure class already filed per surface with real detail (ux-agent-api-key-flag-on-help.md, ux-provider-login-api-key-flag-history-risk.md). Its only distinct contribution is naming it as systemic. Either promote it to the umbrella issue for the class - prefer POE_API_KEY/stdin, warn when the flag is used, document the env var - and link the per-surface files to it, or retire it as a duplicate. Do not fix per command."
---

# UX: --api-key encourages argv secrets

## Summary

Flags without history warning.

## Evidence

login/configure --api-key.

## Why it matters

Security hygiene.

## Suggested direction

Prefer env/OAuth in help.

## Severity

Medium

## Area

Auth / security

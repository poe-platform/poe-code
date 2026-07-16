---
severity: medium
impact: security
comment: "Duplicate of ux-configure-api-key-shell-history-risk.md (same flag, surface and risk) and a member of the four-surface --api-key class; retire into the umbrella ux-auth-login-api-key-shell-history-risk.md. No distinct content beyond restating the class."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/configure.ts:75 declares .option(\"--api-key <key>\", \"Poe API key\"), so configure --help lists the flag; same flag also at src/cli/commands/login.ts:32 and src/cli/commands/agent.ts:23"
---

# UX: configure --help advertises --api-key (shell history risk)

## Summary

configure --help lists --api-key <key> Poe API key — encourages shell history leaks (same class as agent/login --api-key).

## Evidence

--api-key <key>  Poe API key

## Why it matters

Reconfirm API key flags on help encourage history leaks.

## Suggested direction

Prefer env/login; warn if flag used; document POE_API_KEY.

## Severity

Medium

## Area

Configure / security

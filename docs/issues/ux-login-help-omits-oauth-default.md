---
severity: medium
impact: usability
comment: "Contentless duplicate within the login help cluster; retire into ux-login-help-omits-interactive-and-yes.md. Its framing 'primary path hidden' is the crispest statement of why this matters and should survive."
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- login --help prints only '--api-key <key>' and '-h, --help'; the OAuth browser flow default lives at src/cli/options.ts:160 (init.loginViaOAuth) and src/cli/oauth-login.ts:16, undocumented in help. Duplicate of ux-login-help-omits-interactive-and-yes.md."
---

# UX: login help omits OAuth default

## Summary

Only --api-key documented.

## Evidence

login --help.

## Why it matters

Primary path hidden.

## Suggested direction

Document OAuth.

## Severity

Medium

## Area

Auth / help

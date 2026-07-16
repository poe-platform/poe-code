---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/provider.ts:390 executeProviderLogout calls unconfigureServicesForProvider (line 552), which rewrites/removes agent configs for the provider; src/cli/container.ts:160,212 confirm dual credential stores credentials.enc plus provider-scoped credentials.poe.enc"
comment: "Duplicate within the poe logout scope trio; retire into ux-provider-logout-dry-run-unconfigures-agents.md. Its framing is the clearest of the three and should survive: separate credential logout from agent unconfigure. The rm of both credentials.poe.enc and credentials.enc is worth noting - two credential stores again, echoing ux-provider-login-poe-yes-fails-despite-auth-status-logged-in.md."
---

# UX: provider logout poe --dry-run also rewrites agent configs

## Summary

provider logout poe --dry-run not only rm credentials.poe.enc but also rewrites goose config and more — broader than credential logout (related logout overclaims).

## Evidence

rm credentials.poe.enc; rm credentials.enc; rewrite goose config.yaml…

## Why it matters

Provider logout looks like full unconfigure for agents using poe.

## Suggested direction

Separate credential logout from agent unconfigure; intentional-only diffs.

## Severity

**High**

## Area

Providers / destructive

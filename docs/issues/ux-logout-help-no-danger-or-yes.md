---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- logout --help shows only '-h, --help' and 'Remove all configuration and credentials.'; src/cli/commands/logout.ts:11-12 sets that description with no --yes option, and src/cli/commands/auth.ts:53-55 reuses the same text while executeLogout deletes configs and unconfigures every service without confirmation"
comment: "Duplicate of ux-logout-help-no-danger-or-scope-detail.md; retire into it. Its added coverage is worth carrying: auth logout shares the same help text, so the alias has the same undocumented blast radius (ux-auth-logout-same-as-logout-help.md)."
---

# UX: logout help omits danger blast radius and --yes

## Summary

logout and auth logout help: Remove all configuration and credentials — no --yes, no factory-reset blast radius (agents, configs).

## Evidence

logout Options: -h only. Description: Remove all configuration and credentials.

## Why it matters

Critical logout overclaims + destructive without documented --yes.

## Suggested direction

Document factory-reset scope; require --yes non-TTY; danger help.

## Severity

**High**

## Area

Auth / destructive

---
severity: low-medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/install.ts:88 unconditionally completes with 'Installed ${adapter.label}.'; src/services/service-install.ts:42 logs 'already installed.' only through context.logger, wired to logger.verbose at src/providers/create-provider.ts:155, and runServiceInstall's boolean return is discarded, so default output never shows an already-present state. Duplicate of ux-install-always-success-reconfirmed.md, which is the keep of the pair."
comment: "Contentless twin of ux-install-always-success-reconfirmed.md; retire into it. The shared point is legitimate: reporting 'Installed X' when nothing was installed hides a no-op and conflicts with the already-exists convention the repo gets right elsewhere (ux-config-init-already-exists-good.md)."
---

# UX: install always Installed

## Summary

No already-present state.

## Evidence

install twice.

## Why it matters

No-op unclear.

## Suggested direction

Already installed.

## Severity

Low–Medium

## Area

Install

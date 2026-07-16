---
severity: low-medium
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/configure.ts:147-158 short-circuits before any configure/mutation output when skipIfConfigured and hasMaterialConfigureChange is false; configure.ts:268-272 emits 'Dry run: <label> is already configured.' instead of would-configure noise; check is silent (createNoopMutationObservers at configure.ts:306, createSilentDryRunCommand at configure.ts:298); confirmed by sibling positive note ux-skip-if-configured-cursor-already-configured-dry-run-good.md"
comment: "Contentless duplicate within the skip quartet; retire into ux-skip-if-configured-help-text-lies.md. Rated Low-Medium against its High/Critical siblings for the same behavior; normalise on merge."
---

# UX: skip-if-configured dry-run noise

## Summary

Still full would-configure.

## Evidence

configure flags.

## Why it matters

CI unclear.

## Suggested direction

would skip line.

## Severity

Low–Medium

## Area

Configure

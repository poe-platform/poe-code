---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "packages/toolcraft-design/src/components/command-errors.ts:4-17 emits only label+hint with no candidate matching; src/cli/program.ts:960-971 default action calls throwCommandNotFound so commander's showSuggestionAfterError(true) (program.ts:857) never fires. Probe `npm run dev -- confgure` printed 'Unknown command: confgure' with no did-you-mean."
comment: "One of several filings of the missing did-you-mean. Consolidate with ux-root-typos-no-did-you-mean-configure-spawn.md and ux-root-typo-still-no-suggestions-reconfirmed.md. The decisive evidence lives in ux-toolcraft-has-suggestions-poe-code-root-does-not.md: suggestions already exist in-repo, so this is an inconsistency to propagate rather than a feature to build - cheaper than its Medium implies."
---

# UX: Unknown commands no Did you mean

## Summary

confgure/skills/pipelne no suggestion.

## Evidence

Unknown command panels.

## Why it matters

Typos dead-end.

## Suggested direction

Distance match full registry.

## Severity

Medium

## Area

Errors / recovery

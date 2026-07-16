---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "Probe `npm run dev -- configuree` printed 'Unknown command: configuree' + 'Run npm run dev -- --help' with no did-you-mean; same for modell. Cause: src/cli/program.ts:963-971 default action calls throwCommandNotFound, bypassing commander's showSuggestionAfterError(true) at program.ts:857; packages/toolcraft-design/src/components/command-errors.ts:4-17 emits only label+hint with no candidate matching. No-fix here only because this is the 4th duplicate filing - track under ux-toolcraft-has-suggestions-poe-code-root-does-not.md."
comment: "Duplicate within the did-you-mean quartet, differing only in which typos were tried; retire. Trying more typo spellings does not strengthen the case - the absence of suggestions was established by the first one."
---

# UX: root typos configuree/modell have no suggestions (reconfirmed)

## Summary

configuree and modell → Unknown command + npm run dev — no Did you mean configure/models.

## Evidence

Unknown command: configuree
Unknown command: modell
Run npm run dev -- --help

## Why it matters

Reconfirm typo suggestions + identity.

## Suggested direction

Levenshtein suggestions; displayBinaryName.

## Severity

Medium

## Area

Help

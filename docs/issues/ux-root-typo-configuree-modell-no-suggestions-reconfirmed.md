---
severity: medium
impact: usability
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

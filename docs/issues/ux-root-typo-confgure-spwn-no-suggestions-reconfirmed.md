---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- confgure / spwn both print 'Unknown command: <input>' with no suggestions; src/cli/program.ts:961-969 root action calls throwCommandNotFound, and src/cli/command-not-found.ts passes no candidates to formatCommandNotFoundPanel (packages/toolcraft-design/src/components/command-errors.ts:4). Duplicate of ux-root-typos-no-did-you-mean-configure-spawn.md"
comment: "One of four filings of the missing root did-you-mean; consolidate into ux-root-typos-no-did-you-mean-configure-spawn.md. All four also bundle the npm run dev line, which belongs to the identity cluster - split it out so the suggestions work is not blocked on the identity fix."
---

# UX: root typos confgure/spwn have no suggestions (reconfirmed)

## Summary

confgure and spwn → Unknown command + npm run dev help — no Did you mean configure/spawn.

## Evidence

Unknown command: confgure
Unknown command: spwn
Run npm run dev -- --help

## Why it matters

Reconfirm typo suggestions gap + identity.

## Suggested direction

Levenshtein suggestions; displayBinaryName.

## Severity

Medium

## Area

Help

---
severity: high
impact: usability
comment: "Third duplicate within the did-you-mean quartet; retire. Rated High against its Medium twins for identical behavior; normalise on merge."
reproduced: y
recommendation: no-fix
evidence: "Probes `npm run dev -- confgure` and `npm run dev -- spaen` both print 'Unknown command: <input>' plus the help footer with no suggestion; src/cli/program.ts:960-971 root default action calls throwCommandNotFound so commander showSuggestionAfterError(true) (program.ts:857) never fires, and packages/toolcraft-design/src/components/command-errors.ts:4-17 emits only label+hint with no candidate matching. Real defect but duplicate of ux-root-typos-no-did-you-mean-configure-spawn.md; fix belongs to the canonical filing."
---

# UX: root typos still have no Did you mean (reconfirmed)

## Summary

confgure and spaen → Unknown command with npm run dev help — no Did you mean configure/spawn.

## Evidence

```bash
$ poe-code confgure
■  Unknown command: confgure
└  Run npm run dev -- --help
```

## Why it matters

Reconfirm typo suggestions platform fix.

## Suggested direction

Did you mean: configure? displayBinaryName=poe-code.

## Severity

**High**

## Area

Help / discoverability

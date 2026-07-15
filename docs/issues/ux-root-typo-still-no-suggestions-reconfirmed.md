---
severity: high
impact: usability
comment: "Third duplicate within the did-you-mean quartet; retire. Rated High against its Medium twins for identical behavior; normalise on merge."
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

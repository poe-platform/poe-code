# UX: root typos confgure/spwn have no Did you mean (poe-code root)

## Summary

Unknown command confgure and spwn show only Run npm run dev -- --help without Did you mean configure/spawn — toolcraft has suggestions, root often does not (reaffirm dual help / suggestions gap).

## Evidence

```bash
$ poe-code confgure
■  Unknown command: confgure
└  Run npm run dev -- --help
$ poe-code spwn
■  Unknown command: spwn
```

## Why it matters

Common typos unrecoverable; npm run dev identity.

## Suggested direction

Did you mean: configure / spawn; displayBinaryName=poe-code.

## Severity

**High**

## Area

Help / suggestions

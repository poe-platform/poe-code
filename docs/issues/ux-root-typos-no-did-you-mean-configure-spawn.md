---
severity: high
impact: usability
comment: "Keep as canonical of the did-you-mean quartet: the only one naming the decisive comparison - toolcraft-hosted commands already produce suggestions while the root does not (ux-toolcraft-has-suggestions-poe-code-root-does-not.md), making this an inconsistency to propagate rather than a feature to build. Temper the fix with ux-eval-unknown-command-suggests-lint-for-list.md, which shows edit-distance alone yields nonsense ('list' to 'lint'): the root needs distance plus an alias map and a relevance floor."
---

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

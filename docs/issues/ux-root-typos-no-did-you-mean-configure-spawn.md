---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/command-not-found.ts:6-24 passes only unknownCommand/helpArgs into formatCommandNotFoundPanel (packages/toolcraft-design/src/components/command-errors.ts:4-17), which emits label+hint with no candidate list; root default action src/cli/program.ts:961-969 supplies no candidates and root src/ never imports toolcraft suggest (packages/toolcraft/src/suggest.ts:1); probe 'npm run dev -- confgure' printed 'Unknown command: confgure' then 'Run npm run dev -- --help for available commands.' with no Did you mean line"
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

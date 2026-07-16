---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/experiment.ts:1106 declares .option('--force', 'Overwrite existing files') but options.force is never read in the action body and installSkill (src/skills.ts) exposes no force/overwrite parameter, so the documented flag is inert; the praised positive does not hold."
comment: "Awkward positive that contradicts its own cluster: it praises --force being documented while three sibling files prove the documented behavior never happens, and it even hedges ('still need real overwrite behavior verification'). Documenting a flag that lies is not a positive. Retire into the --force cluster; the only durable point is its comparison that pipeline install does not document --force at all, which belongs with ux-experiment-install-already-exists-vs-pipeline-skip.md."
---

# UX: experiment install documents --force (positive-ish)

## Summary

experiment install --help lists --force Overwrite existing files — better than pipeline install force opacity; still need real overwrite behavior verification.

## Evidence

--force  Overwrite existing files

## Why it matters

Positive force documentation on experiment install.

## Suggested direction

Keep; ensure --force actually overwrites.

## Severity

Low

## Area

Experiment / positive pattern

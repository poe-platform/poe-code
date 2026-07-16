---
severity: low
impact: none
comment: "Positive pattern, no code change. Third duplicate of the --activity-timeout-ms 0 validation observation; adds only the -1 case and a note to reuse the style for gaslight timeouts. Merge that detail into ux-activity-timeout-zero-good-validation.md and retire this file."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/spawn.ts:597-604 parsePositiveInt rejects 0/-1 with 'Expected a positive integer.' - positive note, no defect; duplicates ux-activity-timeout-zero-good-validation.md"
---

# UX: --activity-timeout-ms 0/-1 validates cleanly (positive)

## Summary

Invalid activity timeout returns Expected a positive integer without stack.

## Evidence

```bash
$ poe-code spawn … --activity-timeout-ms 0
■  Invalid --activity-timeout-ms "0". Expected a positive integer.
```

## Why it matters

Positive validation pattern.

## Suggested direction

Keep; share with gaslight timeouts when added.

## Severity

Low

## Area

Spawn / positive pattern

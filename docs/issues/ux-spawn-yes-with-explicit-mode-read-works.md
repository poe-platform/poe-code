---
severity: low
impact: none
comment: "Useful small positive: it proves an explicit --mode overrides the --yes yolo default, so the escape hatch works and the Critical is about the default rather than broken precedence. That bounds the fix - only the fallback needs changing. Keep and link from ux-spawn-yes-defaults-mode-to-yolo.md."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/spawn.ts:479-487 resolveSpawnMode returns explicitMode before the flags.assumeYes yolo fallback, so --mode read wins; positive note, no defect"
---

# UX: spawn --yes --mode read works (positive override of yolo default)

## Summary

spawn … --yes --mode read succeeds — explicit --mode overrides --yes yolo default as help implies.

## Evidence

spawn claude … --yes --mode read --model haiku → ok

## Why it matters

Positive that mode flag wins; still document --yes yolo footgun.

## Suggested direction

Keep override order; document clearly.

## Severity

Low

## Area

Spawn / positive pattern

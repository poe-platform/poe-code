---
severity: low
impact: none
comment: "Positive pattern; consolidate with ux-usage-balance-presentation-good.md. Its value beyond the praise is as the counterexample the bare-group cluster needs: usage defaults to balance rather than dumping help, exactly what ux-many-parent-groups-only-dump-help.md asks the other nine groups to do. Cite it there."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/usage.ts:168-174 bare 'usage' action calls executeBalance; renderBalanceDisplay at :59-80 prints Balance/Plan/Add-on plus daily and monthly grant lines - positive note, no defect"
---

# UX: usage default balance card is good (positive reconfirm)

## Summary

usage with no subcommand shows balance card with plan/add-on and next grant — strong positive.

## Evidence

usage → Balance $… Plan/Add-on breakdown; Next monthly grant.

## Why it matters

Positive default command behavior.

## Suggested direction

Keep; document default is balance in help.

## Severity

Low

## Area

Usage / positive pattern

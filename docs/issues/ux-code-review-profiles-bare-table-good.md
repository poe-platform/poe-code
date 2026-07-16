---
severity: low
impact: polish
comment: "Filed as positive-ish yet it still asks for a design-system frame, so it is the same observation as ux-code-review-profiles-bare-table.md rated Low instead of Medium - a direct contradiction on identical output. Four files report this one table. Consolidate and settle whether a bare table here is acceptable or a defect; it cannot be both."
reproduced: n
recommendation: no-fix
evidence: "npm run dev -- code-review profiles renders exactly the described readable name/source table (generic | built-in); packages/agent-code-review/src/cli.ts:88-105 handler returns plain data with no design-system panel, so the output matches the note - but this is a positive/no-defect filing and the fourth duplicate of ux-code-review-profiles-bare-table.md, which is the canonical defect view."
---

# UX: code-review profiles bare table is readable (positive-ish)

## Summary

code-review profiles shows simple name/source table with generic built-in — readable but no design-system panel.

## Evidence

name generic | source built-in

## Why it matters

Acceptable minimal table; could use design-system header.

## Suggested direction

Optional design-system frame.

## Severity

Low

## Area

Code-review

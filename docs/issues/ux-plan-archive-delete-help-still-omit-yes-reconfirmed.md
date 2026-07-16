---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "npm run dev -- plan archive --help / plan delete --help list only path, --kind, --output, -h; --yes is root-only (src/cli/program.ts:852) and plan.ts:717-750 declares no --yes or non-TTY note, while executePlanAction (plan.ts:482) and selectPlan (plan.ts:330-334) depend on it"
comment: "One of three filings of the plan archive/delete help gap; consolidate. This is the best of them because it covers both commands and names all three asks: require a path non-TTY, document --yes, and forbid --yes without a path. That last one is the Critical (ux-plan-archive-delete-yes-picks-arbitrary-plan.md), so the help gap is secondary to the behavior fix - sequence it after."
---

# UX: plan archive/delete help still omit --yes and non-TTY contract (reconfirmed)

## Summary

plan archive and delete --help still only path, --kind, --output, -h — no --yes, no warning that --yes without path archives/deletes arbitrary plan, no non-TTY path requirement.

## Evidence

plan archive/delete --help — path optional; no --yes documented.

## Why it matters

Reconfirm Critical destructive footgun is undocumented in help.

## Suggested direction

Require path non-TTY; document --yes; forbid --yes without path.

## Severity

**High**

## Area

Plan / destructive

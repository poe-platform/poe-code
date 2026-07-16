---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "`npm run dev -- plan archive --help` lists only [path], --kind, --output, -h; global -y/--yes declared at src/cli/program.ts:852 is not shown; src/cli/commands/plan.ts:329-330 returns options.plans[0] when assumeYes and no path"
comment: "Duplicate within the plan archive help trio; retire into ux-plan-archive-delete-help-still-omit-yes-reconfirmed.md, which covers delete too. Its framing is the sharpest of the three: destructive help must document the non-interactive contract, because that is precisely where the footgun fires."
---

# UX: plan archive --help omits --yes / selection behavior

## Summary

plan archive help shows optional path and --kind/--output but does not document non-TTY selection requiring path or --yes, nor that --yes without path archives an arbitrary plan.

## Evidence

plan archive --help — path optional; no --yes mentioned (global --yes may apply).

## Why it matters

Destructive command help must document non-interactive contract and footguns.

## Suggested direction

Document required path for non-TTY; forbid --yes without path; list --yes if supported.

## Severity

**High**

## Area

Plan / destructive

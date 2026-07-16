---
severity: medium
impact: correctness
comment: "Contentless duplicate within the README-in-plan-list quintet; retire into ux-plan-list-includes-readme-reconfirmed.md. Its 'footgun' framing is the accurate one and worth carrying: the risk is not the extra row but that README is classified as a plan at all."
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- plan list prints row 'plan | Plan | README.md | Active Plans'; packages/plan-browser/src/discovery.ts:60 isSupportedPlanFile accepts any .md with no meta-file exclusion, and classifyPlanKind defaults frontmatter-less files to kind 'plan'"
---

# UX: plan list includes README

## Summary

README.md listed as plan.

## Evidence

plan list.

## Why it matters

Noise/footgun.

## Suggested direction

Exclude meta.

## Severity

Medium

## Area

Plan browser

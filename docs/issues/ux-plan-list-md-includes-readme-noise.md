---
severity: medium
impact: correctness
comment: "Duplicate within the README-in-plan-list quintet (md variant); retire into ux-plan-list-includes-readme-reconfirmed.md."
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- plan list --kind plan --output md prints row '| plan | Plan | README.md | Active Plans |'; packages/plan-browser/src/discovery.ts:60 isSupportedPlanFile accepts any .md and classifyPlanKind:145 defaults frontmatter-less files to kind 'plan'"
---

# UX: plan list --output md still includes README.md as a plan

## Summary

plan list --kind plan --output md includes README.md Active Plans row — reconfirm plan-list-includes-noise-files.

## Evidence

markdown table includes | plan | Plan | README.md | Active Plans |

## Why it matters

Reconfirm README noise in plan lists.

## Suggested direction

Exclude README and non-plan docs from list.

## Severity

Medium

## Area

Plan list

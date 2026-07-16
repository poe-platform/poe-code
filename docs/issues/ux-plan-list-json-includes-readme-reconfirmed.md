---
severity: medium
impact: correctness
comment: "Duplicate within the README-in-plan-list quintet (json variant); retire into ux-plan-list-includes-readme-reconfirmed.md. It does usefully show the noise reaches the machine contract too, so scripts consuming plan list receive README as a plan - carry that detail."
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- plan list --output json emits {name: README.md, path: docs/plans/README.md}; packages/plan-browser/src/discovery.ts:62 accepts any .md with no README exclusion"
---

# UX: plan list --output json includes README.md (reconfirmed)

## Summary

plan list --output json has 11 entries including README.md — reconfirm noise.

## Evidence

11 plans; README.md present.

## Why it matters

Reconfirm filter README.

## Suggested direction

Exclude README.md.

## Severity

Medium

## Area

Plan list

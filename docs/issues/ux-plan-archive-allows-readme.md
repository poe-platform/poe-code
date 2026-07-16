---
severity: medium
impact: correctness
reproduced: y
recommendation: fix
evidence: "npm run dev -- plan archive docs/plans/README.md --dry-run --output json returns {action: archive, path: docs/plans/README.md, dryRun: true}; discovery.ts:62 accepts any .md and no README guard exists in packages/plan-browser/src/actions.ts:43-69 or src/cli/commands/plan.ts:497-509; the skipped/confirmationRequired path (plan.ts:463-479) is the generic non-TTY confirm gate, not a README block."
comment: "Contentless but names a real hazard: README.md is the plans index, and archiving it would remove the directory's entry point. Interesting tension with ux-plan-archive-json-skips-without-explaining-why.md, which shows archive on README returns skipped:true with confirmationRequired - so README may already be blocked, or may merely be awaiting confirmation. Resolve that before treating it as a defect. Same family as ux-plan-list-includes-readme-reconfirmed.md: README is treated as a plan by some paths and not others."
---

# UX: plan archive allows README

## Summary

Would archive README.md.

## Evidence

plan archive --dry-run README.

## Why it matters

Destroys index.

## Suggested direction

Refuse meta.

## Severity

Medium

## Area

Plan browser

---
severity: medium
impact: data-loss
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

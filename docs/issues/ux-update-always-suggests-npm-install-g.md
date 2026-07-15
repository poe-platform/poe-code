---
severity: medium
impact: usability
comment: "Contentless twin of ux-update-dry-run-always-global-npm.md; retire. The shared point is fair: update assumes a global npm install regardless of how poe-code was actually installed, so the suggested command is wrong for anyone using bun, pnpm or a local install. Note ux-update-package-manager-override-works.md shows --package-manager exists, so the gap is detection rather than capability."
---

# UX: update always npm install -g

## Summary

Ignores install method.

## Evidence

update --dry-run.

## Why it matters

Wrong upgrade path.

## Suggested direction

Detect install method.

## Severity

Medium

## Area

Update

---
severity: low
impact: none
comment: "Third filing of the package-manager override positive (bun, pnpm, pnpm again); consolidate into ux-update-package-manager-override-works.md. Testing each package manager separately adds nothing once the flag is shown to be parameterised."
---

# UX: update --package-manager pnpm --dry-run is clean (positive)

## Summary

update --package-manager pnpm --dry-run: would run pnpm add -g poe-code@latest — clean package-manager override dry-run.

## Evidence

◇  Command pnpm add -g poe-code@latest
●  Dry run: would run pnpm add -g poe-code@latest.

## Why it matters

Positive package-manager override dry-run.

## Suggested direction

Keep.

## Severity

Low

## Area

Update / positive pattern

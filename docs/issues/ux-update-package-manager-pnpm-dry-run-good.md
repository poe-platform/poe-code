---
severity: low
impact: none
comment: "Third filing of the package-manager override positive (bun, pnpm, pnpm again); consolidate into ux-update-package-manager-override-works.md. Testing each package manager separately adds nothing once the flag is shown to be parameterised."
reproduced: n
recommendation: no-fix
evidence: "Positive note, no defect. src/services/update.ts:60-66 maps pnpm to 'pnpm add -g poe-code@latest'; src/cli/commands/update.ts:57-60 prints the dry-run line. Probe 'npm run dev -- update --package-manager pnpm --dry-run' output: 'Dry run: would run pnpm add -g poe-code@latest.'"
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

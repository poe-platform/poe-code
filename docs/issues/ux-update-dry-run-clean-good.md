---
severity: low
impact: none
comment: "Duplicate of ux-update-dry-run-always-global-npm.md; retire into it. Its aside about version-nag noise belongs to the version-nag cluster."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/update.ts:58-60 dry-run branch logs 'would run' and returns before executing installer; positive note, no defect"
---

# UX: update --dry-run is clean (positive)

## Summary

update --dry-run: would run npm install -g poe-code@latest — clean intentional dry-run.

## Evidence

Dry run: would run npm install -g poe-code@latest.

## Why it matters

Positive dry-run.

## Suggested direction

Keep; suppress version nag noise on dev separately.

## Severity

Low

## Area

Update / positive pattern

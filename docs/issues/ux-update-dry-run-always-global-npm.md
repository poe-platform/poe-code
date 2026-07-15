---
severity: low
impact: none
comment: "Positive-with-a-caveat; consolidate with ux-update-dry-run-clean-good.md. The dry-run itself is exemplary - it echoes the exact command it would run, the clearest possible preview - and the caveat (always -g) is the real issue, better stated in ux-update-always-suggests-npm-install-g.md. Cite the command-echo pattern as a dry-run template; it is more useful than a diff for command-executing operations."
---

# UX: update --dry-run always plans global npm install (positive-ish)

## Summary

update --dry-run plans npm install -g poe-code@latest — clear dry-run (always -g; package-manager override exists).

## Evidence

Dry run: would run npm install -g poe-code@latest.

## Why it matters

Positive dry-run command echo; global-only remains an issue.

## Suggested direction

Keep dry-run; document global-only; support local monorepo skip.

## Severity

Low

## Area

Update / positive pattern

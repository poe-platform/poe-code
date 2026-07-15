---
severity: low
impact: none
comment: "Positive pattern; near-duplicate of ux-runtime-init-dry-run-clean.md (docker versus host). Consolidate. The pair usefully shows runtime init's dry-run is intentional-only and states both effects (config change plus file creation) - the shape the configure dry-run cluster wants. Cite as a precedent there."
---

# UX: runtime init --type docker --dry-run is clean (positive)

## Summary

runtime init --type docker --yes --dry-run: would set runtime.type docker; would create Dockerfile — clean.

## Evidence

Dry run: would set runtime.type to "docker".

## Why it matters

Positive dry-run.

## Suggested direction

Keep.

## Severity

Low

## Area

Runtime / positive pattern

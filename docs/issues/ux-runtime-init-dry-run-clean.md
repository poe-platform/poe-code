---
severity: low
impact: none
comment: "Duplicate of ux-runtime-init-docker-dry-run-clean.md with --type host; retire into it. Its 'would create Dockerfile if missing' detail is the better one - a conditional effect stated conditionally, which is precisely the fidelity ux-gaslight-install-force-dry-run-vs-already-exists.md finds missing elsewhere."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/runtime/init.ts:42-48 dryRun branch logs 'would set runtime.type' plus conditional Dockerfile line then returns before any write; positive note, no defect"
---

# UX: runtime init --dry-run is clean (positive)

## Summary

runtime init --type host --yes --dry-run: would set runtime.type; would create Dockerfile if missing — intentional dry-run.

## Evidence

Dry run: would set runtime.type to "host".

## Why it matters

Positive dry-run pattern.

## Suggested direction

Keep.

## Severity

Low

## Area

Runtime / positive pattern

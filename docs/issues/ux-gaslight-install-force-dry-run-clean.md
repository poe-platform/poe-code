---
severity: low
impact: none
comment: "Directly contradicted by ux-gaslight-install-force-dry-run-vs-already-exists.md, which shows this same --force --dry-run says 'Would create' when the file already exists - so the output praised here as clean is inaccurate. Reconcile: the dry-run is well-framed but wrong about the operation. Do not cite it as the precedent for force+dry-run until that is fixed. Near-duplicate of ux-gaslight-install-global-dry-run-clean.md."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/gaslight.ts:298 guards writes behind !dryRun (no filesystem changes confirmed), but :290-297 returns changed=true under --force for an existing file and :445 prints 'Would create', so the 'clean' framing is a positive note whose wording defect is tracked in ux-gaslight-install-force-dry-run-vs-already-exists.md"
---

# UX: gaslight install --force --dry-run is clean (positive)

## Summary

gaslight install --local --force --dry-run: Would create path; Would install; no filesystem changes — clean dry-run even with --force.

## Evidence

Would create: …/gaslight.yaml; # no filesystem changes

## Why it matters

Positive force+dry-run pattern (contrast non-dry force overwrite risk).

## Suggested direction

Keep; apply to experiment/pipeline install.

## Severity

Low

## Area

Gaslight / positive pattern

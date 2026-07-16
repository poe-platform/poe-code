---
severity: low
impact: none
comment: "Positive pattern and the necessary control for the ralph cluster: 'Ralph doc not found' is correct here because the path genuinely does not exist. That is precisely what makes the same message wrong in ux-ralph-init-plan-says-not-found.md, where the file exists - one message serving two conditions. Keep as the reference case."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/ralph.ts:467 throws ValidationError('Ralph doc not found: ' + docPath) when readFile fails; correct for a genuinely absent path - positive note, no defect"
---

# UX: ralph init missing doc is clear (positive)

## Summary

ralph init /tmp/no-ralph.md --yes: Ralph doc not found: path — clear (kind-aware enough).

## Evidence

■  Ralph doc not found: /tmp/no-ralph.md

## Why it matters

Positive missing path.

## Suggested direction

Keep.

## Severity

Low

## Area

Ralph / positive pattern

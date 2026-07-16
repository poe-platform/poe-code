---
severity: medium
impact: usability
comment: "Contentless ('Raw + toolcraft both.', 'Single path.') and fully covered by ux-code-review-drafts-missing-arg-double-error.md, which has the transcript. Retire - it is the fourth filing of the code-review double-error skin and the cluster needs one issue, not four."
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- code-review drafts prints raw 'error: missing required argument 'prUrl'' then design-system panel repeating it; real CLI passes exitOverride false and no suppressCommanderOutput (src/cli/bootstrap.ts:47, src/cli/program.ts:782-790). Behaviour real but duplicate of ux-code-review-drafts-missing-arg-double-error.md."
---

# UX: code-review double error skin

## Summary

Raw + toolcraft both.

## Evidence

code-review run.

## Why it matters

Looks broken.

## Suggested direction

Single path.

## Severity

Medium

## Area

Errors

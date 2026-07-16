---
severity: low
impact: none
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/experiment.ts:645 throws ValidationError 'Experiment doc not found: ${docPath}'; probe 'npm run dev -- experiment validate /tmp/no-exp.md' printed '■  Experiment doc not found: /tmp/no-exp.md' for a genuinely absent file"
comment: "Positive pattern, useful precisely for the contrast it draws: the same 'Experiment doc not found' message is correct here (the path genuinely does not exist) and wrong in ux-experiment-validate-wrong-kind-says-not-found.md (the file exists but is the wrong kind). That pairing proves the two conditions need distinct messages rather than that the message is bad. Keep as the reference case."
---

# UX: experiment validate missing path is clear (positive)

## Summary

experiment validate /tmp/no-exp.md: Experiment doc not found — clear missing path (wrong-kind still says not found separately).

## Evidence

■  Experiment doc not found: /tmp/no-exp.md

## Why it matters

Positive missing path.

## Suggested direction

Keep; fix wrong-kind message separately.

## Severity

Low

## Area

Experiment / positive pattern

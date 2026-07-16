---
severity: low
impact: none
comment: "Near-duplicate of ux-eval-lint-missing-eval-structured-table-good.md (same lint table, warnings rather than errors); consolidate. Worth carrying over: the W004 warning about pinning target.ref to a full SHA shows lint already reasons about eval targets, which is directly relevant to the broken placeholder target in ux-eval-check-fails-on-placeholder-target-git-remote.md - lint may already be capable of catching that scaffold problem."
reproduced: n
recommendation: no-fix
evidence: "packages/agent-eval/src/cli/lint.ts:17-21,69-71 renders yellow Warnings table with Code/Path/Message columns; packages/agent-eval/src/lint/lint.ts:104 emits W004 'target.ref is not a full commit SHA; pin it to a commit SHA'. Positive note, no defect."
---

# UX: eval lint warning table is good (positive)

## Summary

eval lint shows Warnings table with Code W004, path, message about pinning target.ref to SHA — scannable.

## Evidence

eval lint good-eval-name → Warnings table W004 target.ref not full SHA.

## Why it matters

Positive lint UX.

## Suggested direction

Keep; use for eval check errors too.

## Severity

Low

## Area

Eval / positive pattern

---
severity: low
impact: none
reproduced: y
recommendation: no-fix
evidence: "packages/agent-eval/src/cli/lint.ts:66,71 push color.red('Errors')/color.yellow('Warnings') then renderIssueTable with Code/Path/Message columns (line 18); codes E001/E002/E004/E005/W001 emitted in packages/agent-eval/src/lint/lint.ts:53,65,74,123,163"
comment: "Strong positive and more useful than most: coded diagnostics (E001-E005, W001) in a structured table are exactly what the eval empty-source cluster lacks, and the pattern already ships in the same command group. Cite it as the in-product precedent from ux-eval-empty-source-message-inconsistent-skins.md; its own suggestion to reuse the shape for eval check errors is the actionable half. Near-duplicate of ux-eval-lint-table-good.md - consolidate."
---

# UX: eval lint missing eval shows structured error table (positive)

## Summary

eval lint no-such-eval shows Errors/Warnings tables E001–E005 missing eval.yaml/plan.md/oracle — structured diagnostic without stack.

## Evidence

E001 eval.yaml missing; E002 plan.md missing; E004 oracle missing; W001 solution missing.

## Why it matters

Positive structured lint diagnostics.

## Suggested direction

Keep; design-system title optional.

## Severity

Low

## Area

Eval / positive pattern

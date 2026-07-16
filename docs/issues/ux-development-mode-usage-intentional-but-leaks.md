---
severity: high
impact: polish
reproduced: y
recommendation: no-fix
evidence: "src/utils/execution-context.ts:197-201 formatCliUsageCommand returns 'npm run dev --' for mode development; consumed by src/cli/program.ts:840-841 (usage/help copy) and src/cli/command-not-found.ts:20; rg over skills/, templates/, docs/design*, README.md found no committed artifact containing 'npm run dev --', so the string only appears when the CLI is actually run from source, where it is the correct invocation"
comment: "Root-cause file for the whole 'npm run dev' identity cluster and the most useful of that family: it names the mechanism (execution-context maps development to 'npm run dev --' in formatCliUsageCommand) and the fix (separate displayBinaryName from debugInvocation). Dozens of per-command identity filings collapse into this one change. Keep as canonical. The nuance it captures matters: the mapping is intentional for dev, so the bug is that the dev invocation leaks into user-facing copy, not that the mapping exists."
---

# UX: Dev-mode usage intentionally emits npm run dev

## Summary

execution-context maps development to npm run dev -- leaking into all help/errors.

## Evidence

formatCliUsageCommand development case.

## Why it matters

Root cause of identity cluster.

## Suggested direction

Split displayBinaryName vs debugInvocation.

## Severity

**High**

## Area

Help / identity

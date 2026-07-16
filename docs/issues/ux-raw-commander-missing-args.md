---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "npm run dev -- unconfigure prints raw 'error: missing required argument (agent)'; src/cli/commands/unconfigure.ts:30 .argument('<agent>') with src/cli/bootstrap.ts:47 exitOverride:false and suppressCommanderOutput unset (src/cli/program.ts:782) leaves Commander's reporter in charge. No wrap command exists in src/cli/commands."
comment: "Keep as the umbrella for the raw-Commander missing-argument family (agent, spawn, code-review, memory install/write, maestro tick each file an instance). Its fix - intercept at the Commander integration layer - closes roughly ten filings at once, one of the better leverage points in the audit. Pair with ux-code-review-drafts-missing-arg-double-error.md, which shows the same layer also double-renders."
---

# UX: Missing required args raw Commander

## Summary

unconfigure/wrap missing agent raw error.

## Evidence

error: missing required argument agent

## Why it matters

Inconsistent error skin.

## Suggested direction

Design-system intercept.

## Severity

Medium

## Area

Errors

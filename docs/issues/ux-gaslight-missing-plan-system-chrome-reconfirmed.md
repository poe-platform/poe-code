---
severity: medium
impact: usability
comment: "Another instance of the systemic UserError-vs-system-chrome issue: the message ('Plan file not found') is already right and only the 'See logs' tease is wrong. Retire into ux-user-errors-look-like-system-failures.md; the gaslight-specific residue is just the 'suggest gaslight install' recovery."
reproduced: y
recommendation: fix
evidence: "packages/agent-gaslight/src/run.ts:51 throws plain Error (not CliError isUserError), so src/cli/bootstrap.ts:71-79 prints 'Error: ...' plus 'See logs at ...'; probe: POE_NO_PROMPT=1 npm run dev -- gaslight /tmp/missing-plan-xyz.yaml output 'Error: Plan file not found: /tmp/missing-plan-xyz.yaml' + 'See logs at ...errors.log'"
---

# UX: gaslight missing plan still system chrome (reconfirmed)

## Summary

gaslight /tmp/missing.yaml: Plan file not found + See logs — reconfirm ValidationError gap.

## Evidence

gaslight missing file → Plan file not found + See logs.

## Why it matters

Reconfirm UserError for missing plan.

## Suggested direction

ValidationError without logs; suggest gaslight install.

## Severity

Medium

## Area

Gaslight

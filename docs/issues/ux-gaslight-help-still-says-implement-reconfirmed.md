---
severity: high
impact: usability
comment: "Reconfirm duplicate of ux-gaslight-help-says-plan-to-implement.md; retire into it. Its added detail is worth carrying: --mode defaults to auto, which compounds the Implement default - the two defaults together are what make a bare 'gaslight <plan>' dangerous."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/gaslight.ts:312 argument help 'Markdown plans to implement sequentially'; :320-323 --mode Option .default('auto'); duplicate of docs/issues/ux-gaslight-help-says-plan-to-implement.md"
---

# UX: gaslight help still says plan to implement (reconfirmed)

## Summary

gaslight --help Argument plan-path: Markdown plan to implement; default mode auto — still steers Implement (Critical gaslight mutation class).

## Evidence

plan-path  Markdown plan to implement
--mode default auto

## Why it matters

Reconfirm gaslight Implement steering still in help.

## Suggested direction

Markdown plan to run; default prompt must not auto-Implement.

## Severity

**High**

## Area

Gaslight / help

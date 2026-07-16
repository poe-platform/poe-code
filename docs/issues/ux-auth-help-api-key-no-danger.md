---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/auth.ts:26 .description(\"Display stored API key.\"); `npm run dev -- auth --help` lists 'api-key  Display stored API key.' with no secret-reveal warning"
comment: "Fourth filing of the help-warning point, this one at group level (the auth --help command list) rather than the command's own help. Only distinct angle: the warning is missing one level up too. Fold into the consolidated help issue as a checklist item; do not track separately."
---

# UX: auth help lists api-key without danger note

## Summary

auth --help lists api-key Display stored API key with no danger/secret warning at group level.

## Evidence

api-key  Display stored API key.

## Why it matters

Group help should warn secret reveal.

## Suggested direction

Display stored API key (sensitive; prefer mask).

## Severity

Medium

## Area

Auth

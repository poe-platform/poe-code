---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "npm run dev -- code-review prompt-preview </dev/null printed 'Missing required parameter \"spawn\".' + 'Run npm run dev -- code-review prompt-preview --help for usage.'; packages/toolcraft/src/cli.ts:5001 emits the missing-required message with no enum choices, unlike branch errors at cli.ts:4809 which append formatAvailableList; usage prefix comes from rootUsageName in src/cli/program.ts:726 fed by formatCliUsageCommand (src/utils/execution-context.ts:197) which returns 'npm run dev --' in development mode"
comment: "Another instance of npm run dev recovery on a toolcraft-hosted command; belongs to the CLI-wide identity cluster rather than to code-review. Its one distinct and worthwhile ask is listing the valid --spawn choices in the error, a real usability gain independent of the identity fix. Keep that, merge the rest."
---

# UX: code-review prompt-preview missing spawn uses npm run dev

## Summary

prompt-preview without --spawn: Missing required parameter spawn + npm run dev recovery.

## Evidence

Missing required parameter "spawn". Run npm run dev -- code-review prompt-preview --help

## Why it matters

displayBinaryName; design-system.

## Suggested direction

poe-code recovery; list spawn choices.

## Severity

Medium

## Area

Code-review / identity

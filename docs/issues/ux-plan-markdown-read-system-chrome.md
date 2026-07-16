---
severity: medium
impact: usability
comment: "Contentless, and covered better by ux-plan-view-vs-markdown-read-not-found-inconsistent.md, which shows the same missing-file case beside plan view's clean message. Retire into that - the contrast is what makes it actionable."
reproduced: y
recommendation: no-fix
evidence: "Live probe 'npm run dev -- plan markdown-read definitely-missing-file.md' printed 'Error: file not found: definitely-missing-file.md' plus 'See logs at ~/.poe-code/logs/errors.log'; toolcraft UserError at packages/markdown-reader/src/core/document.ts:126 is not a CliError, so src/cli/bootstrap.ts:71-79 takes the else branch and appends chrome, unlike ValidationError (src/cli/errors.ts:69 isUserError true) used by plan view at src/cli/commands/plan.ts:320. Behaviour real but duplicate of ux-plan-view-vs-markdown-read-not-found-inconsistent.md, which absorbs this file."
---

# UX: plan markdown-read system chrome

## Summary

file not found + logs.

## Evidence

markdown-read missing.

## Why it matters

Friendly tools.

## Suggested direction

ValidationError.

## Severity

Medium

## Area

Plan

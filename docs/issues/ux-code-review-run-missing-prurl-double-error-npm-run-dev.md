---
severity: medium
impact: usability
comment: "Duplicate of ux-code-review-drafts-missing-arg-double-error.md on the run subcommand instead of drafts; identical output, identical fix. Retire into it."
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- code-review run prints raw 'error: missing required argument prUrl' then the design-system panel repeating it plus 'Run npm run dev -- code-review run --help for usage.'; positional defined at packages/agent-code-review/src/cli.ts:164. Real but identical to canonical ux-code-review-drafts-missing-arg-double-error.md."
---

# UX: code-review run missing prUrl double error + npm run dev

## Summary

code-review run: missing required argument prUrl twice (raw commander + framed) and npm run dev recovery.

## Evidence

error: missing required argument 'prUrl'
■  error: missing required argument 'prUrl'
Run npm run dev -- code-review run --help

## Why it matters

Double error + identity leak.

## Suggested direction

Single ValidationError; poe-code recovery.

## Severity

Medium

## Area

Code-review / identity

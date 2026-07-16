---
severity: medium
impact: usability
comment: "Keep - this is the actionable version of the markdown-read chrome complaint because it supplies the control: the same missing-file condition produces a clean 'Plan not found' from plan view and 'file not found ... See logs' from markdown-read, within one command group. That makes it an inconsistency to close rather than a systemic reskin, and it absorbs ux-plan-markdown-read-system-chrome.md."
reproduced: y
recommendation: fix
evidence: "plan.ts:320 throws ValidationError (CliError isUserError=true) so bootstrap.ts:72 prints clean 'Plan not found: missing.md'; markdown-read surfaces toolcraft UserError from packages/markdown-reader/src/core/document.ts:126, which is not a CliError, so bootstrap.ts:74-79 adds 'Error:' prefix plus 'See logs'. Probe confirms both outputs."
---

# UX: plan view vs markdown-read not-found messages inconsistent

## Summary

plan view missing.md → Plan not found: missing.md (clean, no logs). plan markdown-read missing.md → file not found: missing.md + See logs. Same concept, different quality.

## Evidence

```bash
$ poe-code plan view missing.md
■  Plan not found: missing.md
$ poe-code plan markdown-read missing.md
■  Error: file not found: missing.md
●  See logs …
```

## Why it matters

Inconsistent not-found quality within plan group.

## Suggested direction

Unify Plan not found ValidationError; no logs.

## Severity

Medium

## Area

Plan

---
severity: medium
impact: usability
comment: "Keep - this is the actionable version of the markdown-read chrome complaint because it supplies the control: the same missing-file condition produces a clean 'Plan not found' from plan view and 'file not found ... See logs' from markdown-read, within one command group. That makes it an inconsistency to close rather than a systemic reskin, and it absorbs ux-plan-markdown-read-system-chrome.md."
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

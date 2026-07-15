---
severity: medium
impact: polish
comment: "Best evidence of the three install filings - the pasted output shows absolute paths hard-wrapped mid-filename, which reads as corrupted output rather than success. Keep as canonical for the presentation half (one path per line, no mid-path wrapping); let ux-code-review-install-no-dry-run-force-writes.md carry the missing --dry-run and retire ux-code-review-install-unframed-and-npm-run-dev.md into the two."
---

# UX: code-review install success is unframed and path-wrapped badly

## Summary

code-review install prints Lists Created with hard-wrapped absolute paths mid-word without design-system panel — hard to read.

## Evidence

```text
Created      /Users/…/.poe-code/code-review/profiles/gen
             eric.md, /Users/…/pro
             mpts/orchestrator.md, …
```

## Why it matters

Broken wrapping looks like corruption; toolcraft group.

## Suggested direction

Design-system file list one path per line.

## Severity

Medium

## Area

Code-review

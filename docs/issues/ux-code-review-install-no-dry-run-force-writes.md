---
severity: medium
impact: usability
comment: "One of three filings of the code-review install output; bundles three asks (--dry-run, path wrapping, displayBinaryName). Its distinct and most valuable contribution is the missing --dry-run on a command that writes files - a capability gap rather than cosmetics. Split that out and keep it; the wrapping half duplicates ux-code-review-install-output-unframed-wrapped.md."
---

# UX: code-review install --force writes with no dry-run and wraps paths poorly

## Summary

code-review install --force creates profiles/prompts under .poe-code/code-review with word-wrapped path lists and no --dry-run option; help uses npm run dev.

## Evidence

code-review install --force → Created …paths word-wrapped mid-path…

## Why it matters

Unexpected writes; hard to read paths.

## Suggested direction

Add --dry-run; design-system path list; displayBinaryName.

## Severity

Medium

## Area

Code-review

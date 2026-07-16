---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "packages/agent-code-review/src/cli.ts:69-86 install params expose only cwd/force (no dryRun, unlike prompt-preview cli.ts:209 dryRun), and installCodeReviewAssets writes via mkdir/writeFile at packages/agent-code-review/src/assets.ts:280,376,436"
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

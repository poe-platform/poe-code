---
severity: high
impact: usability
comment: "The most analytically valuable file in the flood cluster and not a duplicate: it identifies why the flood actively misleads rather than merely being long. Rendering the diff as '--- /dev/null' presents pre-existing file content as though poe-code were authoring it, misattributing values the tool never touched - it specifically notes this is how existing effortLevel xhigh appears to be written by configure. That misattribution plausibly contaminated other filings in the effort cluster, so fix this presentation early and re-verify the xhigh reports afterwards."
---

# UX: configure dry-run presents full existing settings as create-from-null

## Summary

configure claude dry-run often shows --- /dev/null +++ settings.json with full 145-line content including effortLevel xhigh from existing file merge presentation — looks like creating entire config from scratch even for partial updates; confuses source of xhigh (existing file vs poe-code write).

## Evidence

claude-code configure only merges env + model in source; dry-run still shows full file + with effortLevel xhigh from existing settings.

## Why it matters

Users cannot tell what poe-code will change vs preserve.

## Suggested direction

Intentional-only diff of merge keys; label preserved fields.

## Severity

**High**

## Area

Dry-run

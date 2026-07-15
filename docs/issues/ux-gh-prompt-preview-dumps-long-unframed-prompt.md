---
severity: medium
impact: polish
comment: "Duplicate in shape of ux-code-review-prompt-preview-unframed.md - same toolcraft-hosted prompt-preview, same unframed multi-screen dump, same --json ask; consolidate into one prompt-preview presentation issue. The --json half is the useful part: these outputs are long enough that a machine mode beats nicer framing."
---

# UX: gh prompt-preview dumps long unframed prompt text

## Summary

github-workflows prompt-preview prints multi-section prompt body without design-system framing or --json option; toolcraft identity on help.

## Evidence

prompt-preview fix-vulnerabilities dumps long guideline text with │ prefixes only.

## Why it matters

Hard to scan; no machine mode.

## Suggested direction

Panel + --json; displayBinaryName.

## Severity

Medium

## Area

GitHub workflows

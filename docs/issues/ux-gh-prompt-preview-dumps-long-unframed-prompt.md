---
severity: medium
impact: polish
comment: "Duplicate in shape of ux-code-review-prompt-preview-unframed.md - same toolcraft-hosted prompt-preview, same unframed multi-screen dump, same --json ask; consolidate into one prompt-preview presentation issue. The --json half is the useful part: these outputs are long enough that a machine mode beats nicer framing."
reproduced: y
recommendation: no-fix
evidence: "packages/github-workflows/src/commands.ts:481-483 rich render is logger.message(result.prompt) with no panel; 'npm run dev -- github-workflows prompt-preview fix-vulnerabilities' emits 42 unframed lines and --help usage says 'npm run dev -- github-workflows prompt-preview'; machine mode does exist via --output json (--json is rejected as unknown option). Duplicate of ux-code-review-prompt-preview-unframed.md, which carries the fix."
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

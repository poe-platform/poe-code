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

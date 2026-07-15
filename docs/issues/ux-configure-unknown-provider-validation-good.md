---
severity: low
impact: none
comment: "Third duplicate of the Unknown-provider positive; retire into ux-configure-unknown-provider-see-logs-missing.md. Its one distinct contribution is worth relocating rather than losing: provider login shows 'See logs' for this same class of error while configure does not, and that inconsistency belongs with ux-provider-login-missing-key-system-chrome.md."
---

# UX: configure unknown provider error is clear (positive)

## Summary

configure --provider not-a-provider → Unknown provider "not-a-provider" without See logs — good ValidationError.

## Evidence

■  Error: Unknown provider "not-a-provider".

## Why it matters

Positive provider validation.

## Suggested direction

Keep; align provider login to drop See logs.

## Severity

Low

## Area

Configure / positive pattern

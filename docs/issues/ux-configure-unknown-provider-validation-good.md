---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/configure.ts:838 throws plain Error, not ValidationError; src/cli/bootstrap.ts:70-80 appends See logs for non-CliError. Probe `npm run dev -- configure claude --provider not-a-provider --yes --api-key fake` printed 'Error: Unknown provider \"not-a-provider\".' followed by 'See logs at ...errors.log'; the doc's no-See-logs claim was a --dry-run artifact."
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

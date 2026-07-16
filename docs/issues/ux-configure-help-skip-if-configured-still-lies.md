---
severity: high
impact: none
reproduced: n
recommendation: no-fix
evidence: "configure.ts:147-158 skips before writes when hasMaterialConfigureChange (overlay byte-compare, configure.ts:289-325) is false; configure.ts:268-275 reports already configured for both live and dry runs; vitest --skip-if-configured exits before writes when configure would only create a backup passes (1 passed)"
comment: "Reconfirm of Critical #12 (ux-skip-if-configured-help-text-lies.md); retire into it. This is the documentation-side symptom of a behavioral bug: help promises 'exit without writes when current config already matches' while the behavior rewrites anyway. Fix the behavior and the help becomes true - do not 'fix' it by weakening the help text, which would ratify the bug."
---

# UX: configure --help still claims skip-if-configured exits without writes (reconfirmed)

## Summary

configure --help: --skip-if-configured Exit without writes when current config already matches — help still lies (Critical #12).

## Evidence

--skip-if-configured  Exit without writes when current config already matches

## Why it matters

Reconfirm Critical help lie still present.

## Suggested direction

Truthful help: skip only when fully matching; dry-run shows would skip.

## Severity

**High**

## Area

Configure / help

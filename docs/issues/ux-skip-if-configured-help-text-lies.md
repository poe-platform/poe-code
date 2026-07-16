---
severity: critical
impact: none
reproduced: n
recommendation: no-fix
evidence: "configure.ts:148-158 short-circuits to skippedConfigured before any writes when hasMaterialConfigureChange (configure.ts:289-325 overlay compare) is false, with no flags.dryRun branch; configure.ts:268-274 reports 'already configured' for live and dry runs; vitest -t skip-if-configured: 1 passed"
comment: "Keep as canonical of the skip-if-configured cluster and correctly Critical: help promises 'Exit without writes when current config already matches' and the flag both rewrites live config (ux-skip-if-configured-yes-rewrote-dead-sonnet-5.md) and plans full rewrites on match. A safety flag that does the opposite of its documentation is worse than an absent one, because users rely on it. The fix is cheaper than it looks - ux-skip-if-configured-cursor-already-configured-dry-run-good.md proves the correct short-circuit already ships for cursor. Do not resolve by weakening the help text."
---

# UX: --skip-if-configured help says exit without writes when config matches but behavior differs

## Summary

Help: Exit without writes when current config already matches. Observed: --skip-if-configured --yes rewrote dead sonnet-5; --skip-if-configured --dry-run still plans full rewrite even when model matches.

## Evidence

```text
--skip-if-configured  Exit without writes when current config already matches
```
Live: rewrote config; dry-run plans full create.

## Why it matters

Help text is false advertising for a safety flag.

## Suggested direction

Implement true match-and-skip; dry-run reports would skip; never write dead defaults.

## Severity

**Critical**

## Area

Configure / help

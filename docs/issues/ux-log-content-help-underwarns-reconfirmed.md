---
severity: medium
impact: security
comment: "Reconfirm duplicate within the --log-content trio; retire into ux-log-content-flag-no-danger-warning.md. Its 'warn at runtime once' suggestion is the better half of the fix and should survive - help warnings are missed precisely by the users who paste flags from CI examples."
---

# UX: --log-content help underwarns sensitive data (reconfirmed)

## Summary

Help only says Include message and tool content in ACP JSONL spawn logs without security warning; default redacts but flag opts into content.

## Evidence

spawn --help: --log-content Include message and tool content…

## Why it matters

Reconfirm of log-content underwarn.

## Suggested direction

Add (may include secrets/PII) to help; warn at runtime once.

## Severity

Medium

## Area

Spawn / security

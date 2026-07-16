---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/auth.ts:26 description is only 'Display stored API key.'; `npm run dev -- auth api-key --help` prints that line plus only '-h, --help'"
comment: "Reconfirm duplicate in the help-warning sub-cluster with no new evidence; retire into the consolidated help issue."
---

# UX: auth api-key help still no danger warning (reconfirmed)

## Summary

auth api-key --help still only Display stored API key with -h — reconfirm no secret warning.

## Evidence

auth api-key help: Display stored API key. Options: -h only.

## Why it matters

Reconfirm Critical secret reveal lacks help warning.

## Suggested direction

Warn in description; default mask + --reveal.

## Severity

**High**

## Area

Auth / security

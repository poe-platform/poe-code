---
severity: low
impact: none
comment: "Duplicate of ux-login-api-key-rejected-good.md with weaker evidence (no post-check that the session survived); retire into it. Its 'do not leave partial credentials' framing is the right rule to carry forward."
reproduced: n
recommendation: no-fix
evidence: "src/cli/options.ts:117-122 validates via checkAuth and throws 'API key rejected.' before apiKeyStore.write, so no fake key is persisted; positive note, no defect. Duplicate target docs/issues/ux-login-api-key-rejected-good.md exists."
---

# UX: login --api-key sk-fake --yes rejected clearly (positive)

## Summary

login --api-key sk-fake --yes: API key rejected — clear without writing fake key (when not logged in).

## Evidence

■  API key rejected.

## Why it matters

Positive rejection of bad key.

## Suggested direction

Keep; do not leave partial credentials.

## Severity

Low

## Area

Auth / positive pattern

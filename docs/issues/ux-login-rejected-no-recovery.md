---
severity: medium
impact: usability
comment: "Fair and small: 'API key rejected.' is a correct terminal state with no path forward - no link to where keys are issued, no hint whether the key was malformed or revoked - and onboarding is exactly where recovery matters most. The positive filings praise this same message for not clobbering the session, which is a separate property; both readings are compatible: safe behavior, incomplete copy."
---

# UX: API key rejected no recovery

## Summary

API key rejected only.

## Evidence

login --api-key fake.

## Why it matters

Onboarding dead end.

## Suggested direction

Link keys URL.

## Severity

Medium

## Area

Auth

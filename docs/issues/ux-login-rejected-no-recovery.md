---
severity: medium
impact: usability
comment: "Fair and small: 'API key rejected.' is a correct terminal state with no path forward - no link to where keys are issued, no hint whether the key was malformed or revoked - and onboarding is exactly where recovery matters most. The positive filings praise this same message for not clobbering the session, which is a separate property; both readings are compatible: safe behavior, incomplete copy."
reproduced: y
recommendation: fix
evidence: "src/cli/options.ts:119 and :142 throw bare Error('API key rejected.'); no keys URL or malformed-vs-revoked hint exists anywhere in src/ or packages/, while the sibling throw at src/cli/options.ts:155 does offer recovery steps ('Pass --api-key, set POE_API_KEY, or run without --yes')"
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

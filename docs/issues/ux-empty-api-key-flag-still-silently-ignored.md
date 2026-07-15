---
severity: high
impact: correctness
comment: "Reconfirm of the empty --api-key issue on configure; retire into ux-empty-api-key-login-good-but-configure-ignores.md, which covers the same behavior with the decisive login contrast. Its one useful detail is that the existing Bearer still appears in the plan, confirming the empty flag is dropped rather than merely unused."
---

# UX: --api-key "" still silently ignored on configure (reconfirmed)

## Summary

configure … --api-key "" --yes --dry-run still plans config with existing Bearer (redacted) — empty explicit flag ignored rather than rejected.

## Evidence

configure --api-key "" still proceeds with redacted bearer from existing auth.

## Why it matters

Reconfirm empty explicit flags should error.

## Suggested direction

Reject empty --api-key when flag present.

## Severity

**High**

## Area

Configure / flags

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

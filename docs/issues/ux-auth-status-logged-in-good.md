---
severity: low
impact: none
comment: "Positive pattern, no code change - but genuinely useful as the contrast case for the auth secrets cluster: status identifies the account without printing any credential material, which is exactly the shape auth api-key should adopt. Cite it from ux-auth-api-key-prints-secret.md as the in-product precedent for masking."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/auth.ts:96 stops spinner with 'Logged in as ${identity.name} (@${identity.handle})' - identity only, no apiKey in output; positive note, no defect to reproduce"
---

# UX: auth status logged-in is clear (positive)

## Summary

auth status: Logged in as Name (@handle) — clear without secrets.

## Evidence

◆  Logged in as Kamil Jopek (@kamil)

## Why it matters

Positive auth status.

## Suggested direction

Keep.

## Severity

Low

## Area

Auth / positive pattern

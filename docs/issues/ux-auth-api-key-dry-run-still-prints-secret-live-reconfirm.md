---
severity: critical
impact: usability
comment: "Duplicate reconfirm in the four-file auth api-key --dry-run cluster; contributes only a second live sighting and no new evidence. Retire into ux-auth-api-key-dry-run-still-prints-secret.md."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/auth.ts:110 passes flags.dryRun only as readOnly, then :116 process.stdout.write(apiKey) unconditionally; behaviour real but canonical ux-auth-api-key-dry-run-still-prints-secret.md already carries recommendation=fix"
---

# UX: auth api-key --dry-run still prints full secret (live reconfirm)

## Summary

Reconfirmed live: auth api-key --dry-run prints full key line (redacted in audit logs only by us) — Critical still open.

## Evidence

auth api-key --dry-run → sk-poe-… on stdout.

## Why it matters

Reconfirm Critical secret reveal.

## Suggested direction

Mask by default; --reveal for full; never dry-run print.

## Severity

**Critical**

## Area

Auth / security

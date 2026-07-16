---
severity: high
impact: security
comment: "One of four filings of the same defect (auth api-key ignores --dry-run and prints the key). Adds only a date and the detail that ~50 chars of output confirms a full key. Retire into ux-auth-api-key-dry-run-still-prints-secret.md. Its High severity contradicts the three Critical siblings - normalise to Critical."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/auth.ts:108-116 - executeApiKey uses flags.dryRun only for readOnly, then unconditionally runs process.stdout.write(apiKey) with no mask or dry-run guard; duplicate of canonical ux-auth-api-key-dry-run-still-prints-secret.md, fix tracked there"
---

# UX: auth api-key --dry-run still prints full secret (2026-07-08 reconfirm)

## Summary

auth api-key --dry-run still prints the full sk-poe-… key on a single line (length ~50). No mask, no dry-run suppression. Critical #4 class reconfirmed live.

## Evidence

```bash
$ poe-code auth api-key --dry-run
sk-poe-<REDACTED full key printed>
# output length ~50 chars, single line, has_sk=true
```

## Why it matters

Reconfirm Critical secret leak still open; never print full keys in logs/docs.

## Suggested direction

Mask by default; --reveal opt-in; dry-run must not print secrets.

## Severity

**High**

## Area

Auth / dry-run

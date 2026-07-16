---
severity: critical
impact: security
comment: "Duplicate reconfirm; restates that dry-run is ignored and adds nothing further. Retire into ux-auth-api-key-dry-run-still-prints-secret.md."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/auth.ts:110-116 executeApiKey passes flags.dryRun only as readOnly then unconditionally process.stdout.write(apiKey); duplicate of ux-auth-api-key-dry-run-still-prints-secret.md"
---

# UX: auth api-key --dry-run still prints secret (reconfirmed)

## Summary

Reconfirmed Critical: auth api-key --dry-run still emits the full API key (dry-run ignored).

## Evidence

```bash
$ poe-code auth api-key --dry-run
# full key on stdout
```

## Why it matters

Live reconfirm of secret leak.

## Suggested direction

Mask by default; dry-run must not reveal.

## Severity

**Critical**

## Area

Auth / dry-run

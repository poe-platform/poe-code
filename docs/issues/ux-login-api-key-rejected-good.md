---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/options.ts:116-122 resolveApiKey validates explicit --api-key via checkAuth and throws 'API key rejected.' before apiKeyStore.write; src/cli/commands/login.ts:51-56 passes dryRun:true/allowStored:false, so a bad key never overwrites the stored session. Positive note, no defect."
comment: "Genuinely valuable positive: it establishes that a rejected key does not clobber the existing session - the reject-without-side-effects property the destructive-command cluster wants everywhere. Near-duplicate of ux-login-fake-key-rejected-good.md; keep this one, which has the stronger evidence (auth status still logged in afterwards). Cite it from ux-empty-api-key-login-good-but-configure-ignores.md: login is the reference implementation for credential input validation."
---

# UX: login --api-key rejected is clear (positive)

## Summary

login --api-key sk-fake-not-real → API key rejected without overwriting session; auth status still logged in.

## Evidence

```bash
$ poe-code login --api-key "sk-fake-not-real" --yes
■  API key rejected.
$ poe-code auth status
◆  Logged in as …
```

## Why it matters

Positive reject-without-clobber behavior.

## Suggested direction

Keep.

## Severity

Low

## Area

Auth / positive pattern

---
severity: low
impact: none
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

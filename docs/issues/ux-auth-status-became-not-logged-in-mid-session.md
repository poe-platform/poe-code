---
severity: high
impact: usability
comment: "Weakest-evidence High in the auth set: the report itself admits the cause is unknown (expiry vs a concurrent process vs an audit side effect) and the session had been running dry-run unconfigure commands, so the observation is contaminated. Do not schedule a fix from this - it needs reproduction. The durable residue is the diagnosis gap it exposes: 'Not logged in' never says why. File that (reason codes for missing vs expired vs cleared, plus a doctor check) and close this."
---

# UX: auth status flipped to Not logged in mid-audit session

## Summary

Earlier auth status Logged in as Kamil and whoami worked; later same session auth status: Not logged in and spawn fails No API key. No intentional logout run by audit (only dry-run unconfigure). Credentials may have expired or concurrent process cleared them.

## Evidence

```bash
# earlier
◆  Logged in as Kamil Jopek (@kamil)
# later same session
●  Not logged in
■  No API key found. Set POE_API_KEY or run 'poe-code login'.
```

## Why it matters

Silent credential loss mid-session is confusing; doctor/status should explain why.

## Suggested direction

Status: Not logged in (credentials missing/expired). Run login. Doctor check.

## Severity

**High**

## Area

Auth

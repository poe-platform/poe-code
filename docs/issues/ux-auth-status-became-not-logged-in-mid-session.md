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

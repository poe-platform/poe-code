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

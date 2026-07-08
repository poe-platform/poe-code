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

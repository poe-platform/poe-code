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

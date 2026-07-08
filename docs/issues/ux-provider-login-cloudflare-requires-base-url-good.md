# UX: provider login cloudflare missing base URL is clear (positive)

## Summary

Provider "cloudflare" requires a base URL. Pass --base-url or set CF_AIG_BASE_URL — clear recovery (still See logs on one path).

## Evidence

```bash
$ poe-code provider login cloudflare --yes
■  Error: Provider "cloudflare" requires a base URL. Pass --base-url or set CF_AIG_BASE_URL.
```

## Why it matters

Positive required-field recovery.

## Suggested direction

Keep; drop See logs.

## Severity

Low

## Area

Providers / positive pattern

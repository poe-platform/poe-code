# UX: logout --dry-run still prints full API keys and bearer tokens (reconfirmed)

## Summary

Reconfirmed live: logout --dry-run dumps goose secrets.yaml with CUSTOM_POE_API_KEY: sk-poe-… and experimental_bearer_token values — Critical secret leak still present.

## Evidence

```bash
$ poe-code logout --dry-run
# includes CUSTOM_POE_API_KEY: sk-poe-…
# experimental_bearer_token = "cfut_…" / "sk-poe-…"
```

## Why it matters

Reconfirm Critical #1 still open with fresh evidence.

## Suggested direction

Redact secrets in all dry-run diffs; never print full keys.

## Severity

**Critical**

## Area

Security / dry-run

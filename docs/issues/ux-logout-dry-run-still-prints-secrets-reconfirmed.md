---
severity: critical
impact: security
comment: "Correctly Critical and the freshest live evidence for the #1 issue: logout --dry-run emits CUSTOM_POE_API_KEY: sk-poe- and experimental_bearer_token values from goose secrets.yaml. Pairs with ux-dry-run-diffs-print-secrets.md - keep both, this as the reconfirm with concrete file and key names, that as the umbrella. Same fix: route every dry-run diff through the redactor that ux-configure-api-key-dry-run-redacts-bearer.md proves already exists."
---

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

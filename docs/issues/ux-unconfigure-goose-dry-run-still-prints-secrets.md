# UX: unconfigure goose --dry-run still prints full API keys (reconfirm)

## Summary

unconfigure goose --dry-run rewrites secrets.yaml with CUSTOM_POE_API_KEY: sk-poe-… — Critical secret leak class reconfirmed on unconfigure path.

## Evidence

unconfigure goose --dry-run includes CUSTOM_POE_API_KEY: sk-poe-…

## Why it matters

Reconfirm Critical #1 still open on unconfigure.

## Suggested direction

Redact secrets in all dry-run diffs.

## Severity

**High**

## Area

Security / dry-run

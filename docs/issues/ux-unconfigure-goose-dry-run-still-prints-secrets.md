---
severity: high
impact: security
comment: "Fresh live evidence for the Critical secret leak on the unconfigure path; retire into ux-dry-run-diffs-print-secrets.md, the umbrella that already names unconfigure. Its value is confirming the leak spans configure, unconfigure, logout and provider logout - four commands, one unredacted diff formatter. Rated High against that Critical; normalise."
---

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

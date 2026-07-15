---
severity: high
impact: security
comment: "Bundles the flood with the secret leak, which is why it sits at High while the leak itself is Critical elsewhere; split. The flood half duplicates ux-logout-dry-run-still-multi-panel-unconfigure.md and the secrets half belongs to ux-logout-dry-run-still-prints-secrets-reconfirmed.md. Its 'one summary plan' direction is the right shape for the flood family."
---

# UX: logout --dry-run multi-agent flood + secrets

## Summary

Logout dry-run floods diffs, multiple footers, and can print secrets.

## Evidence

logout --dry-run.

## Why it matters

Unsafe unreadable preview.

## Suggested direction

One summary plan; redact secrets.

## Severity

**High**

## Area

Logout / dry-run

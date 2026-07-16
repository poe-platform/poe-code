---
severity: high
impact: security
reproduced: y
recommendation: fix
evidence: "logout --dry-run probe emitted 720 lines, 3 intro panels (logout, unconfigure codex, unconfigure claude-code), 3 footers, and 3 plaintext experimental_bearer_token values with 0 redaction markers; src/cli/commands/logout.ts:44-49 calls executeUnconfigure per service even when flags.dryRun, and src/cli/commands/unconfigure.ts:50 emits its own intro/complete/finalize per agent."
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

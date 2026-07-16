---
severity: high
impact: security
reproduced: y
recommendation: no-fix
evidence: "src/utils/dry-run.ts:380-388 redactContentForDiff only handles .json and .toml, returning .yaml verbatim; goose stores CUSTOM_POE_API_KEY in ~/.config/goose/secrets.yaml (src/providers/goose.ts:30-31) and unconfigure prunes that key plus restores the backup (src/providers/goose.ts:327-337), so the dry-run diff emits the full credential. Duplicate of ux-dry-run-diffs-print-secrets.md, which already carries reproduced=y and recommendation=fix for the same single formatter."
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

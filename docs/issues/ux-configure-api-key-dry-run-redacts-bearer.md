---
severity: low
impact: none
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- configure claude --api-key sk-test-... --dry-run --yes prints '\"ANTHROPIC_CUSTOM_HEADERS\": \"Authorization: Bearer <redacted>\"' and no sk-test key; src/cli/commands/configure-payload.ts:27 PREVIEW_API_KEY plus src/utils/dry-run.ts:9-15 JSON_SENSITIVE_KEYS"
comment: "The most useful positive in the security set: it proves redaction already exists in the configure dry-run path, which reframes the Critical secret-leak cluster (ux-dry-run-diffs-print-secrets.md, ux-logout-dry-run-still-prints-secrets-reconfirmed.md) from 'build redaction' to 'apply the existing redaction consistently' - a much cheaper fix with a known-good reference. Link it from those files; do not retire."
---

# UX: configure dry-run redacts Bearer in ANTHROPIC_CUSTOM_HEADERS (positive)

## Summary

configure dry-run shows Authorization: Bearer <redacted> — good redaction in at least this path (contrast unconfigure/logout full key dumps).

## Evidence

dry-run diff: "ANTHROPIC_CUSTOM_HEADERS": "Authorization: Bearer <redacted>"

## Why it matters

Positive redaction pattern to extend to all dry-run diffs.

## Suggested direction

Apply same redaction everywhere secrets appear in dry-run.

## Severity

Low

## Area

Configure / positive pattern

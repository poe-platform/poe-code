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

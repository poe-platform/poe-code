# UX: invalid --shape-base-url format validation is good (positive)

## Summary

configure --shape-base-url https://example.invalid: Invalid --shape-base-url value. Use <shape-id>=<url> — clear ValidationError.

## Evidence

Invalid --shape-base-url value "https://example.invalid". Use <shape-id>=<url>.

## Why it matters

Positive format validation.

## Suggested direction

Keep.

## Severity

Low

## Area

Configure / positive pattern

---
severity: low
impact: none
comment: "Positive pattern; duplicate of ux-shape-base-url-invalid-validation-good.md - same flag, message and conclusion. Consolidate. The message is genuinely good because it states the required syntax rather than merely rejecting the value - the property the mcp-servers JSON error also has and the models filters lack."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/shared.ts:196-198 - value without '=' gives separatorIndex -1, throwing 'Invalid --shape-base-url value \"...\". Use <shape-id>=<url>.'; duplicate exists at docs/issues/ux-shape-base-url-invalid-validation-good.md"
---

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

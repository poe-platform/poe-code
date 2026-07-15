---
severity: low
impact: none
comment: "One of five near-identical positives about --mcp-servers validation; consolidate the set into one note, with ux-mcp-servers-file-and-json-validation-good.md surviving since it covers two cases at once. Filing one well-validated flag five times is the clearest example of count inflation in the audit."
---

# UX: --mcp-servers @missing-file validation is good (positive)

## Summary

spawn --mcp-servers @/tmp/no-mcp.json: --mcp-servers could not read file path ENOENT — clear ValidationError without See logs.

## Evidence

--mcp-servers could not read file "/tmp/no-mcp.json": ENOENT: …

## Why it matters

Positive @file validation.

## Suggested direction

Keep.

## Severity

Low

## Area

Spawn / positive pattern

---
severity: low
impact: none
comment: "Duplicate within the --mcp-servers positive set; retire into ux-mcp-servers-file-and-json-validation-good.md."
---

# UX: invalid --mcp-servers JSON validation is good (positive)

## Summary

spawn --mcp-servers "{bad" → --mcp-servers must be valid JSON in this shape: {name: {command, args?, env?}} — clear ValidationError.

## Evidence

--mcp-servers must be valid JSON in this shape: …

## Why it matters

Positive JSON validation.

## Suggested direction

Keep.

## Severity

Low

## Area

Spawn / positive pattern

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

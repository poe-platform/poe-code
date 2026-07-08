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

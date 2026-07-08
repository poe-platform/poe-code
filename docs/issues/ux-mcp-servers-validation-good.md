# UX: --mcp-servers invalid entry validation is good (positive)

## Summary

Invalid MCP server JSON without command returns a clear field-level ValidationError without system chrome.

## Evidence

```bash
$ poe-code spawn … --mcp-servers '{"x":{}}'
■  --mcp-servers entry "x" must include a non-empty string "command"
```

## Why it matters

Positive validation pattern to copy.

## Suggested direction

Keep; use for other JSON flags.

## Severity

Low

## Area

Spawn / positive pattern

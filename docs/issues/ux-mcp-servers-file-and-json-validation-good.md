# UX: --mcp-servers @file and invalid JSON validation are good (positive)

## Summary

Missing @file reports could not read file with path; invalid JSON reports required shape — good ValidationErrors.

## Evidence

```bash
$ poe-code spawn … --mcp-servers @/tmp/no-mcp.json
■  --mcp-servers could not read file "…": ENOENT…
$ poe-code spawn … --mcp-servers '{bad'
■  --mcp-servers must be valid JSON in this shape: {name: {command, args?, env?}}
```

## Why it matters

Positive validation patterns.

## Suggested direction

Keep.

## Severity

Low

## Area

Spawn / positive pattern

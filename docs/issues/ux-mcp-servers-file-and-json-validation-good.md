---
severity: low
impact: none
comment: "Keep as the canonical --mcp-servers positive: it covers both the missing @file and invalid JSON cases, and the JSON error is the best in the product - it states the required shape rather than merely rejecting the input. Cite it as the reference from the JSON/enum validation asks elsewhere; retire the other four into it."
---

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

---
severity: low-medium
impact: usability
comment: "Contentless, but its instinct is the most useful in this set: path-not-found messages vary across commands (compare the ENOENT filings for gaslight --config, harness run and traces), so a shared ValidationError helper would fix a family rather than one flag. Reframe it that way and attach the ENOENT cluster to it; as written it adds nothing to the --mcp-servers positives."
---

# UX: --mcp-servers missing file pattern

## Summary

Good message class vary.

## Evidence

@/tmp/no-mcp.json.

## Why it matters

Standardize path errors.

## Suggested direction

Shared ValidationError helper.

## Severity

Low–Medium

## Area

Errors / consistency

---
severity: medium
impact: discoverability
comment: "Honest and self-hedging ('stale docs?'): memory mcp / mcp-print / print-config are all unknown while the capability exists as install --mcp-only. So this is a naming/discoverability gap rather than a missing feature, and the fix is likely documentation plus perhaps one alias. Check its unverified premise first - if nothing advertises those names, there is no defect."
---

# UX: memory print-config/mcp-print commands missing (stale docs?)

## Summary

memory mcp, mcp-print, print-config are unknown; if docs/README mention them they are stale. memory install has --mcp-only for MCP config instead.

## Evidence

```bash
$ poe-code memory print-config
■  Unknown command: print-config
```

## Why it matters

Discoverability of how to print MCP config for memory.

## Suggested direction

Add memory print-mcp-config or document install --mcp-only path.

## Severity

Medium

## Area

Memory

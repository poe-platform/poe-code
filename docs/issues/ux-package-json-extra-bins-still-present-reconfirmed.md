---
severity: high
impact: discoverability
comment: "One of four filings of the same package.json bin list; consolidate into ux-extra-npm-bins-still-published-reconfirmed.md. Four reconfirms of one static file's contents adds nothing - a single check would settle it."
---

# UX: package.json still publishes extra npm bins (reconfirmed)

## Summary

package.json bin still has poe, poe-code-configure, poe-agent, poe-superintendent-mcp, tiny-oauth-test-server, tiny-stdio-mcp-test-server beyond poe-code.

## Evidence

bin keys: poe, poe-code, poe-code-configure, poe-agent, poe-superintendent-mcp, tiny-oauth-test-server, tiny-stdio-mcp-test-server

## Why it matters

Reconfirm slim bins platform fix still open.

## Suggested direction

Only poe-code (and intentional aliases) on npm latest.

## Severity

**High**

## Area

Package / install

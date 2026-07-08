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

# UX: package still publishes extra npm bins (reconfirmed)

## Summary

package.json bin still includes poe, poe-code-configure, poe-agent, poe-superintendent-mcp, tiny-oauth-test-server, tiny-stdio-mcp-test-server alongside poe-code.

## Evidence

bin keys: poe, poe-code, poe-code-configure, poe-agent, poe-superintendent-mcp, tiny-*

## Why it matters

Reconfirm slim bins platform fix.

## Suggested direction

Publish only poe-code (and intentional aliases); move test servers out of main package.

## Severity

**High**

## Area

Package / bins

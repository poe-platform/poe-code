---
severity: high
impact: discoverability
comment: "Keep as canonical of the three bin filings (fullest key list). The concern is real and worse than cosmetic: a global install places tiny-oauth-test-server and tiny-stdio-mcp-test-server on the user's PATH, so test fixtures ship as user-facing commands - a packaging defect rather than IA noise. Resolve alongside ux-binary-wrappers-undocumented.md, which asks to document these same bins: decide what ships first, then document only the survivors."
---

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

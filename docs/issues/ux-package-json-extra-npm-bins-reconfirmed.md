---
severity: high
impact: usability
comment: "Fourth filing of the identical bin list, essentially word-for-word with its sibling; retire into ux-extra-npm-bins-still-published-reconfirmed.md. The strongest argument in the family remains that test servers land on the user's PATH."
reproduced: y
recommendation: no-fix
evidence: "package.json:97-105 bin maps poe, poe-code, poe-code-configure, poe-agent, poe-superintendent-mcp, tiny-oauth-test-server, tiny-stdio-mcp-test-server; duplicate of ux-extra-npm-bins-still-published-reconfirmed.md, ux-extra-npm-bins-confusing.md, ux-extra-npm-bins-still-shipped.md"
---

# UX: package.json publishes extra npm bins (reconfirmed)

## Summary

package.json bin includes poe, poe-code-configure, poe-agent, poe-superintendent-mcp, tiny-oauth-test-server, tiny-stdio-mcp-test-server beyond poe-code.

## Evidence

bin: poe, poe-code, poe-code-configure, poe-agent, poe-superintendent-mcp, tiny-oauth-test-server, tiny-stdio-mcp-test-server

## Why it matters

Reconfirm slim published npm bins platform fix.

## Suggested direction

Only poe-code (and intentional aliases) on npm latest.

## Severity

**High**

## Area

Package / install

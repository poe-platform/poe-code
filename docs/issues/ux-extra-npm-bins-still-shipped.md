---
severity: high
impact: usability
comment: "Duplicate of ux-extra-npm-bins-still-published-reconfirmed.md; retire into it. Its 'global install pollutes PATH with test servers' framing is the sharpest statement of why this matters and should be the wording that survives."
reproduced: y
recommendation: no-fix
evidence: "package.json:97-105 bin has all 7 claimed keys (poe, poe-code, poe-code-configure, poe-agent, poe-superintendent-mcp, tiny-oauth-test-server, tiny-stdio-mcp-test-server); behaviour exists, but ux-extra-npm-bins-still-published-reconfirmed.md is the designated canonical filing, so no-fix here as duplicate."
---

# UX: package still ships many extra npm bins (reconfirmed)

## Summary

Root package.json bin still includes poe, poe-code-configure, poe-agent, poe-superintendent-mcp, tiny-oauth-test-server, tiny-stdio-mcp-test-server — reconfirm of extra-npm-bins-confusing.

## Evidence

package.json bin keys: poe, poe-code, poe-code-configure, poe-agent, poe-superintendent-mcp, tiny-oauth-test-server, tiny-stdio-mcp-test-server

## Why it matters

Global install pollutes PATH with test servers and aliases.

## Suggested direction

Ship only poe-code (and maybe poe alias) for user installs; move test servers out of published bin.

## Severity

**High**

## Area

Packaging

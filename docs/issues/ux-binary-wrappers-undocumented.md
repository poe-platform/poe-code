---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "package.json bin exposes poe-code-configure, poe-superintendent-mcp, tiny-oauth-test-server, tiny-stdio-mcp-test-server; rg finds no README/docs coverage (only docs/issues/*). dist/bin/poe-claude.js etc. are stale gitignored artifacts - scripts/generate-bin-wrappers.mjs:15 emits only poe-agent.js. Subsumed by the extra-bins removal cluster."
comment: "Thin (Evidence is just 'package bins.') and needs the actual bin list pasted before it is actionable. It also has a sequencing dependency that matters more than the content: ux-package-json-extra-bins-still-present-reconfirmed.md and ux-package-json-extra-npm-bins-reconfirmed.md argue the extra poe-* wrappers should not exist at all. Decide whether they are supported entry points first - if they are dropped, documenting them is wasted work."
---

# UX: poe-* bins undocumented

## Summary

dist/bin wrappers no help map.

## Evidence

package bins.

## Why it matters

Multiple entrypoints.

## Suggested direction

Document matrix.

## Severity

Medium

## Area

IA / install

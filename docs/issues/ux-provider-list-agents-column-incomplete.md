---
severity: medium
impact: polish
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/provider.ts:352-356 listShapeCompatibleAgents filters allAgents on agent.apiShapes, so shape-less agents (cursor, pi, claude-desktop) never appear; those agents are provider-less by design (src/providers/cursor.ts:30 requiresProvider: false), so the omission is correct column semantics, not missing data."
comment: "Distinct from the truncation filings and the more interesting of the two: it claims the Agents column omits spawn-only agents, which would be a data problem rather than a rendering one - the same capability-matrix gap as ux-agent-capability-matrix-spawn-vs-configure-vs-install.md seen from the provider side. Too thin to action as filed (no evidence beyond 'provider list'), so verify against the matrix work; if agent lists were derived from one source this would resolve automatically."
---

# UX: provider Agents column incomplete

## Summary

Omits spawn-only agents.

## Evidence

provider list.

## Why it matters

Matrix trust.

## Suggested direction

Document semantics.

## Severity

Medium

## Area

Providers

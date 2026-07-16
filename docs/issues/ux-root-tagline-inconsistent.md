---
severity: low
impact: polish
reproduced: y
recommendation: fix
evidence: "src/cli/program.ts:257 'Configure coding agents to use the Poe API.' vs src/cli/program.ts:851 'Configure Poe API integrations for local developer tooling.' vs src/cli/commands/configure.ts:72 'Configure developer tooling for Poe API.'"
comment: "Contentless and needs the actual taglines pasted to be actionable, but the ask is trivially right: one product string, one constant. Same product-identity family as the npm run dev cluster and the toolcraft-named approval copy (ux-approval-copy-hardcodes-toolcraft-in-source.md) - worth one sweep over user-facing product names rather than three separate fixes."
---

# UX: Product tagline inconsistent

## Summary

Different one-liners.

## Evidence

root vs configure.

## Why it matters

Brand drift.

## Suggested direction

Single constant.

## Severity

Low

## Area

Brand

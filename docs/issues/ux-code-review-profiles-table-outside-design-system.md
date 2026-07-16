---
severity: low-medium
impact: polish
comment: "Contentless fourth copy ('No Poe framing.', 'Dual language.'); retire with no loss. The four-way split across Low / Low-Medium / Low-Medium / Medium for one table is itself the signal: this cluster inflates the issue count without adding information."
reproduced: n
recommendation: no-fix
evidence: "packages/agent-code-review/src/cli.ts:87-104 returns a plain array; toolcraft renderer.ts:322-350 renderArrayTable calls primitives.renderTable, wired at packages/toolcraft/src/design/render-table.ts:1 to toolcraft-design/render-table, so the table is already design-system rendered. Probe 'npm run dev -- code-review profiles' printed the themed box table; only generic auto-render traits (lowercase column titles, no card title) remain, shared by every array command."
---

# UX: code-review profiles bare table

## Summary

No Poe framing.

## Evidence

code-review profiles.

## Why it matters

Dual language.

## Suggested direction

Design-system table.

## Severity

Low–Medium

## Area

Code-review / visual

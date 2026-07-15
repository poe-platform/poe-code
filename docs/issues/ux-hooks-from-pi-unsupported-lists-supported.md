---
severity: low-medium
impact: usability
comment: "Duplicate of ux-hooks-from-unknown-lists-supported-good.md (same allow-list, 'pi' rather than 'notanagent'); consolidate. Both identify the same good half - the error names the bad value and lists supported agents - and the same residue, the 'See logs' tease. Its extra ask (filter --hooks-from choices via Commander) is the better fix and connects to the capability-matrix work in ux-hooks-from-codex-to-claude-transform-unsupported.md."
---

# UX: hooks-from pi unsupported lists supported agents (positive-ish)

## Summary

spawn --hooks-from pi: Unsupported source hook agent "pi". Supported hook agents: claude-code, codex — clear allow-list; still See logs.

## Evidence

Unsupported source hook agent "pi". Supported hook agents: claude-code, codex.
●  See logs …

## Why it matters

Good allow-list; drop See logs; filter --hooks-from choices.

## Suggested direction

UserError; commander choices for --hooks-from.

## Severity

Low–Medium

## Area

Hooks / spawn

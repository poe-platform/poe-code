---
severity: low
impact: none
comment: "Positive pattern; the only residue is documentation - the alias works but nothing states that cursor and cursor-agent are the same surface, so users cannot tell which binary runs. Fold that into the alias documentation ask in ux-command-aliases-undocumented-on-root-help.md. Useful contrast for ux-agent-capability-matrix-spawn-vs-configure-vs-install.md: aliasing works here while pi is rejected outright."
---

# UX: cursor and cursor-agent both work (positive alias note)

## Summary

spawn cursor and spawn cursor-agent both succeed; configure aliases map to same Cursor surface. Positive aliasing (still silent about which binary).

## Evidence

spawn cursor / cursor-agent both run cursor-agent resume lines.

## Why it matters

Document alias relationship in help.

## Suggested direction

Help: cursor is alias of cursor-agent.

## Severity

Low

## Area

Agents / positive pattern

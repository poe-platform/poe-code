---
severity: medium
impact: polish
comment: "Duplicate in substance of ux-utils-config-show-dumps-large-json.md (same output, framing rather than volume); consolidate. Its '---' divider observation is the useful detail: the command invents its own section style rather than using the design system - another instance of the two-output-languages problem."
---

# UX: utils config show dumps raw JSON with --- section headers, no design-system panel

## Summary

`utils config show` outputs two sections (`--- Environment variable overrides ---` and `--- Resolved (merged) ---`) with `---` dividers and raw indented JSON. No design-system panel framing (no pink header, no bracket frame, no glyph) — inconsistent with the rest of the CLI.

## Evidence

```
— Environment variable overrides —
(empty)

— Resolved (merged) —
{
  "ralph": { ... }
}
```

## Why it matters

Visual inconsistency; `---` divider style does not match the pink highlight panel pattern used by other `utils` subcommands.

## Suggested direction

Wrap output in a design-system panel; keep raw JSON content but frame it with the standard Poe header.

## Severity

Medium

## Area

Utils / config / visual

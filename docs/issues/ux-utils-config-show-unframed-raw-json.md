---
severity: medium
impact: polish
comment: "Duplicate in substance of ux-utils-config-show-dumps-large-json.md (same output, framing rather than volume); consolidate. Its '---' divider observation is the useful detail: the command invents its own section style rather than using the design system - another instance of the two-output-languages problem."
reproduced: n
recommendation: no-fix
evidence: "Output IS design-system framed: `npm run dev -- utils config show` prints '┌   Poe - config show' with '│' gutter; src/cli/commands/config.ts:109 logger.intro('config show') and config.ts:180,186 use text.heading (theme.header) per node_modules/toolcraft-design/dist/components/text.js:39; only the '──' divider chars and raw JSON body are ad-hoc, duplicating ux-utils-config-show-dumps-large-json.md"
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

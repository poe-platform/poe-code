---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "FORCE_COLOR=3 npm run dev -- memory status --help emits ESC[95m ESC[1m 'Poe - memory status' (bright magenta bold, same as pipeline --help); plain `memory status` prints no title (src/cli/commands/memory.ts:470-499); only utils symlink --help prints an uncolored title"
comment: "Correct and correctly Low, and its cross-reference is the valuable part: the same white-instead-of-pink title appears on utils symlink --help (ux-utils-symlink-help-missing-design-system-colors.md), so this is a shared code path rather than a memory bug. Merge the two and fix once; alone it reads as a one-off cosmetic nit and would be under-prioritised."
---

# UX: memory status panel title renders in white instead of design-system pink

## Summary

`poe-code memory status` renders the panel title "Poe - memory status" in plain white/grey text rather than the pink used by all other commands. Same root cause as `utils symlink --help` (white title instead of pink).

## Evidence

```
  Poe - memory status    ← white, not pink
[
■  Memory is not initialized. Run "poe-code memory init" in this project.
```

Compare with `poe-code pipeline --help`: "Poe - pipeline" renders in pink.

## Why it matters

Inconsistent — looks like a different CLI or an unstyled fallback. The visual identity breaks for any command that hits this code path.

## Suggested direction

Apply design-system pink to the title, same as all other Poe commands.

## Severity

Low

## Area

Memory / status / visual

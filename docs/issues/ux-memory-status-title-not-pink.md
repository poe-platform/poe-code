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

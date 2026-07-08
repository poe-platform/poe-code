# UX: skill --help Usage line says [options] instead of [command]

## Summary

`poe-code skill --help` shows:

```
Usage: poe-code skill [options]
```

`skill` is a command group with three subcommands (`install`, `configure`, `unconfigure`). Its Usage line should say `[command]` (like every other group command: `memory`, `runtime`, `provider`, etc.) to signal that a subcommand is required.

The current `[options]` usage pattern implies `poe-code skill` runs on its own with flags — it doesn't.

## Evidence

```
Usage: poe-code skill [options]   ← incorrect pattern for a command group

Commands:
  install [options] [agent]       Install an arbitrary skill for an agent.
  configure [options] [agent]     Install skill directories for an agent.
  unconfigure [options] [agent]   Remove skill directories for an agent.
```

Comparable group commands all use `[command]` in their Usage line.

## Why it matters

A new user reading the Usage line first will try `poe-code skill --flag` expecting direct behavior, and be confused when nothing happens. The `[command]` pattern is the correct affordance for groups.

## Severity

Low

## Area

Skill / help / usage / consistency

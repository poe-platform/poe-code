---
severity: low
impact: polish
comment: "Duplicate of ux-group-commands-usage-shows-options-not-command.md, which catches the same pattern across six group commands including skill; retire into it. Its own reasoning is the clearest statement of why it matters - [command] is the affordance signalling a subcommand is required - and is worth carrying into the systemic filing."
reproduced: y
recommendation: no-fix
evidence: "src/cli/program.ts:175 formatCanonicalCommandUsage strips [command]; `npm run dev -- skill --help` prints 'Usage: poe-code skill [options]', but memory/runtime/provider print the same, so the doc's claim that other groups use [command] is false and this is the systemic duplicate."
---

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

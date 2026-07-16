---
severity: low
impact: polish
comment: "Duplicate of ux-group-commands-usage-shows-options-not-command.md, which catches the same pattern across six groups including utils; retire into it. Its own note says as much ('same issue documented for poe-code skill')."
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- utils --help prints 'Usage: poe-code utils [options]' despite src/cli/commands/utils.ts registering config+symlink subcommands; cause is src/cli/program.ts:175 formatCanonicalCommandUsage stripping [command] from all group usage lines - already tracked in ux-group-commands-usage-shows-options-not-command.md"
---

# UX: utils --help Usage line says [options] instead of [command]

## Summary

`poe-code utils --help` shows:

```
Usage: poe-code utils [options]
```

`utils` is a command group with two subcommands (`config`, `symlink`). The usage pattern `[options]` implies `utils` runs directly with flags — it doesn't. All other group commands correctly show `[command]` in their usage line.

This is the same issue documented for `poe-code skill [options]`.

## Why it matters

Users reading the usage line first will look for flags rather than subcommands. The standard `[command]` signal is the correct affordance.

## Severity

Low

## Area

Utils / help / usage / consistency

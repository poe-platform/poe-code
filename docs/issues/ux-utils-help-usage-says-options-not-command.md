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

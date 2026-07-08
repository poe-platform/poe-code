# UX: gaslight run --help title shows "Poe - gaslight" instead of "Poe - gaslight run"

## Summary

`poe-code gaslight run --help` renders its header as:

```
Poe - gaslight
```

Every other subcommand in the CLI includes the full command path in its title. For example:
- `poe-code ralph run --help` → "Poe - ralph run"
- `poe-code pipeline run --help` → "Poe - pipeline run"
- `poe-code memory write --help` → "Poe - memory write"

`gaslight run` is the only `run` subcommand that drops the subcommand from its title.

## Additional issue: Commands section shows siblings, not children

The help for `gaslight run` shows a `Commands:` section listing `ingest` and `install`. These are not children of `run` — they are sibling subcommands of gaslight. Showing them under `run --help` implies a hierarchy that doesn't exist.

## Why it matters

The wrong title breaks the visual breadcrumb pattern. Users who open multiple help panes in their terminal can't identify which help they're reading by the header alone.

## Severity

Medium

## Area

Gaslight / run / help / title / command hierarchy

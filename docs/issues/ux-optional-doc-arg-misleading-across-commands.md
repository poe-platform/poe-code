# UX: [doc] marked optional in ralph init/run, experiment run — but likely required

## Summary

Three commands list `[doc]` as an optional positional argument in their help:

- `poe-code ralph init [options] [doc]`
- `poe-code ralph run [options] [doc]`
- `poe-code experiment run [options] [doc]`

Based on the established pattern with `experiment journal [doc]` (already documented), omitting the optional `[doc]` argument does not default gracefully — it either errors or requires interactive selection that is not documented.

The `[square-bracket]` convention means optional. If omitting the argument reliably errors, it is required and should use `<angle-brackets>`.

## Why it matters

Users reading the usage line will try `poe-code ralph run` without a doc path and be surprised by an error. This is the same discoverability failure as `experiment journal`.

## Suggested direction

Either:
- Make auto-discovery work (find the doc from context), or
- Change `[doc]` to `<doc>` and give a clear error message when omitted

## Severity

Medium (systemic)

## Area

Ralph / experiment / run / init / argument convention

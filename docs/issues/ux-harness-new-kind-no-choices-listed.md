# UX: harness new --help does not list available template kinds

## Summary

`poe-code harness new --help` requires a `<kind>` argument with description "Built-in template kind", but does not list what kinds are available:

```
Arguments:
  kind       Built-in template kind   ← no choices shown
  basename   New harness basename
```

A user must guess or run the command to discover valid values. Other commands that take a constrained set of values show them inline (e.g. `runtime init --type <type>` shows `(choices: "host", "docker", "e2b")`).

## Why it matters

`harness new` is the entry point for scaffolding. Users who don't know the available kinds can't use this command without looking at documentation elsewhere.

## Suggested direction

List available kinds in the argument description, e.g. "Built-in template kind (choices: "safeJS", "pipeline", …)".

## Severity

Medium

## Area

Harness / new / help / argument choices

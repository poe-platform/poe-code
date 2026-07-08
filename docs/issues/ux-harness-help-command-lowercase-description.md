# UX: harness --help lists "help [command]" with lowercase description

## Summary

`harness --help` lists `help [command]` as a subcommand with the description "display help for command" (lowercase first letter). Every other subcommand description in the same list uses sentence-case ("Run a harness pair", "Scaffold a harness pair…", "List discovered harness pairs"). The inconsistency makes the help entry look unfinished.

## Evidence

```
Commands:
  run [options] [md-path]          Run a harness pair.
  new [options] <kind> <basename>  Scaffold a harness pair from a built-in template.
  list                             List discovered harness pairs.
  help [command]                   display help for command
```

"display" should be "Display".

## Why it matters

Minor visual inconsistency but breaks the uniform capitalisation style across the Commands list.

## Suggested direction

Capitalise "Display help for command" to match the rest.

## Severity

Low

## Area

Harness / help / capitalisation

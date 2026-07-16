---
severity: low
impact: polish
comment: "Correct and trivially fixable, and notably this is Commander's own auto-generated 'help [command]' entry rather than repo copy - meaning the same lowercase description appears on every command group, not just harness. Fix once in the Commander configuration and it closes CLI-wide; same family as ux-provider-help-command-lowercase-systemic.md, which spotted the systemic scope. Merge the two."
reproduced: y
recommendation: fix
evidence: "npm run dev -- harness --help prints 'help [command]  display help for command' (lowercase) alongside sentence-case siblings; src/cli/commands/harness.ts:74 creates the group without .addHelpCommand(false), unlike src/cli/commands/pipeline.ts:877 and ralph.ts:684, so Commander's default lowercase text is used."
---

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

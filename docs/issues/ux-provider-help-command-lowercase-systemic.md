---
severity: low
impact: polish
comment: "Keep as canonical over ux-harness-help-command-lowercase-description.md: same Commander-generated 'help [command]' entry, but this file identifies the systemic scope (provider, runtime, harness) and spots the better fix - auth and configure already suppress the meta-subcommand, so the correct pattern exists in-product. Suppressing beats capitalising: it removes clutter rather than tidying it."
---

# UX: "help [command]" subcommand description lowercase across multiple commands

## Summary

Several commands expose a `help [command]` subcommand in their Commands list with a lowercase description "display help for command", while all other subcommand descriptions in the same list use sentence-case. Affected commands:

- `provider --help` → `help [command]   display help for command`
- `runtime --help` → `help [command]   display help for command`
- `harness --help` → `help [command]   display help for command`

Commands that do NOT show this subcommand at all (auth, configure) are actually the correct pattern — the meta-help command adds noise.

## Evidence

```
Commands:
  list            List available providers...
  login [options] <id>  Log in to a provider.
  logout <id>     Log out from a provider.
  help [command]  display help for command    ← lowercase "display"
```

## Why it matters

Breaks the sentence-case capitalisation pattern used by every other description. Also, surfacing `help [command]` as a top-level subcommand is redundant alongside `--help` and adds visual clutter.

## Suggested direction

Capitalise "Display help for command" or, better, suppress the `help` meta-subcommand from the Commands list entirely (as `auth` already does).

## Severity

Low

## Area

Provider / Runtime / Harness / help / capitalisation

---
severity: medium
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/gaslight.ts:307-370 registers gaslight with argument [plan-paths...] and no run subcommand (unlike src/cli/commands/ralph.ts:768, pipeline.ts:881, harness.ts:78). Probe 'npm run dev -- gaslight run --help' prints 'Poe - gaslight' plus 'Usage: poe-code gaslight [options] [plan-paths...]' because run is swallowed as a plan path, so the title correctly names gaslight and Commands lists gaslight's real children ingest and install, not siblings of a nonexistent run."
comment: "Careful observation with two findings, the second being the more substantive: the Commands: section under 'gaslight run --help' lists ingest and install, which are siblings rather than children, so the help asserts a hierarchy that does not exist. That is a consequence of the hybrid shape in ux-gaslight-hybrid-command-confusing-structure.md and should be fixed with it. The title breadcrumb half is cosmetic. Note this file is absent from MASTER.md."
---

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

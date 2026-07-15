---
severity: low
impact: polish
comment: "Careful systemic filing with a real diagnosis: six group commands advertise [options] when they require [command], while memory/runtime/provider/auth/pipeline/experiment get it right - so this is a registration inconsistency rather than copy, and the correct pattern already dominates. One internal error to fix on merge: the summary says 'Four group commands' while the table lists six. Its 'Low (systemic)' rating is the honest one: individually trivial, collectively a coherent single-pass fix."
---

# UX: Multiple group commands show [options] instead of [command] in Usage line

## Summary

Four group commands incorrectly show `[options]` in their Usage line instead of `[command]`. This pattern implies the group itself accepts flags and runs standalone, when in fact all four require a subcommand.

## Affected commands

| Command | Shown | Should be |
|---|---|---|
| `poe-code skill` | `poe-code skill [options]` | `poe-code skill [command]` |
| `poe-code utils` | `poe-code utils [options]` | `poe-code utils [command]` |
| `poe-code usage` | `poe-code usage [options]` | `poe-code usage [command]` |
| `poe-code ralph` | `poe-code ralph [options]` | `poe-code ralph [command]` |
| `poe-code worktree` | `poe-code worktree [options]` | `poe-code worktree [command]` |
| `poe-code harness` | `poe-code harness [options]` | `poe-code harness [command]` |

## Correct examples (for reference)

Commands that get this right: `memory`, `runtime`, `provider`, `auth`, `pipeline`, `experiment` — all show `[command]`.

## Why it matters

Users who read the Usage line first see `[options]` and look for flags. The `[command]` affordance is the standard signal that a group requires a subcommand. This is a systemic registration bug, not a one-off copy issue.

## Severity

Low (systemic)

## Area

CLI / group commands / help / usage / consistency

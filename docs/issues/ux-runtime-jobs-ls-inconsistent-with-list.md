# UX: runtime jobs uses "ls" subcommand instead of "list" like all other commands

## Summary

`poe-code runtime jobs ls` lists detached runtime jobs. Every other list-style command in the CLI uses `list` as the subcommand name:
- `harness list`
- `worktree list`
- `provider list`
- `plan list`
- `memory ls` (also inconsistent — see below)

`runtime jobs ls` uses the Unix shell shorthand `ls`, breaking the naming pattern.

Additionally, `memory ls` (from `memory --help`) also uses `ls` instead of `list`, making this a two-command inconsistency.

## Why it matters

Users who learn the pattern `poe-code <group> list` will type `poe-code runtime jobs list` and get "Unknown command: list". Discovery friction.

## Suggested direction

Rename `runtime jobs ls` → `runtime jobs list` (with `ls` as an alias if backwards compatibility matters). Same for `memory ls` → `memory list`.

## Severity

Low

## Area

Runtime / jobs / memory / naming / consistency

# UX: gaslight --yes flag not listed in Options section

## Summary

`gaslight --help` does not list `--yes` as a standalone option. Like `spawn`, it is referenced only indirectly. The Options section shows no `--yes` entry despite the command accepting it.

## Evidence

Options section shown in help contains `--mode`, `--task`, `--worktree`, `-h` but no `--yes`.

## Why it matters

CI pipelines and non-TTY invocations of `gaslight` cannot confirm intent via `--yes` without knowing it exists. The flag is invisible to help-first users.

## Suggested direction

Add `--yes` explicitly to the Options section matching the pattern of other commands that accept it.

## Severity

Medium

## Area

Gaslight / help / discoverability

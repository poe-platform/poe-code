# UX: superintendent --help uses all-caps headers, inline flag dump, wrong title prefix

## Summary

`superintendent --help` has multiple formatting inconsistencies vs. every other poe-code command:

1. Section header is `COMMANDS` (all caps) not `Commands:` (title-case with colon).
2. Title prefix reads "Poe - poe-code superintendent" — redundant "poe-code" not present in other titles (e.g. "Poe - pipeline", "Poe - ralph").
3. The `run` subcommand dumps all flags inline on a single row: `run [doc] [--agent <value>] [--runtime host|docker|e2b] [--runtime-image <value>] [--runtime-template <value>] [--detach] [--runner-sync both|upload|none] [--tui] [--worktree]` — this line extends off-screen at normal terminal widths.

## Evidence

```
COMMANDS
  run [doc] [--agent <value>] [--runtime host|docker|e2b] [--runtime-image <value>] [--runtime-template <value>] [--detach] [--runner-sync both|upload|none] [--tui] [--worktree]
              Run the full superintendent loop.
  validate <path>
```

Compare with `pipeline --help`:
```
Commands:
  run [options]    Run the selected pipeline plan ...
```

## Why it matters

Visual inconsistency breaks the coherent CLI brand. The inline flag dump on the `run` row makes it unreadable on any normal terminal (80–120 cols).

## Suggested direction

Normalise section headers to title-case-with-colon; strip "poe-code" from the title; show only `run [options] [doc]` in the Commands list and let `--help` on the subcommand show its full flags.

## Severity

High

## Area

Superintendent / help / formatting

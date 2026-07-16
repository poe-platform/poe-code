---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "packages/toolcraft/src/cli.ts:2367 uses text.sectionHeader('Commands') which upper-cases (packages/toolcraft-design/src/components/text.ts:57), vs text.section('Commands:') in src/cli/program.ts; `npm run dev -- superintendent --help` prints 'Poe - poe-code superintendent' and 'COMMANDS' with the run row dumping 8 inline flags (wrapped, not off-screen), while `pipeline --help` prints 'Poe - pipeline'"
comment: "Careful filing with three findings, of which the third is substantive: the run row dumps every flag inline so the line runs off-screen at normal widths, making the Commands list unreadable rather than merely inconsistent. The all-caps COMMANDS header and doubled 'poe-code' in the title are cosmetic. Consolidate with ux-eval-help-npm-run-dev-and-inline-flags.md, which reports the identical shape for eval - and note its own conclusion there: the two share a command-registration pattern, so fix at the source."
---

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

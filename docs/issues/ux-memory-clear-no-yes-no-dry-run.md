---
severity: high
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/memory.ts:555-570 - memory clear calls requireInteractiveStdin/confirmOrCancel unless flags.assumeYes and honours flags.dryRun; --yes and --dry-run are global options at src/cli/program.ts:852-853. Claim of unguarded deletion is false; help-panel-only gap duplicates ux-memory-clear-requires-yes-help-omits-yes.md."
comment: "The most consequential wrong filing in the audit: it reasons entirely from the help panel ('Options: -h, --help') to conclude memory clear 'immediately destroys all memory without any confirmation prompt' and rates it High on that basis - but ux-memory-clear-requires-yes-non-tty-good.md and ux-memory-clear-requires-yes-help-omits-yes.md show the command refuses without --yes. The premise is false, so the High is unearned. Re-rate to the real defects (help gap plus a genuinely missing --dry-run) and treat this as the cautionary case for the audit's help-derived inferences."
---

# UX: memory clear deletes all memory content with no --yes or --dry-run

## Summary

`poe-code memory clear` description: "Delete all memory content and re-initialize INDEX.md and LOG.md." This is a fully destructive, irreversible operation — it deletes all agent memory. Yet the Options section only shows `-h, --help`. There is no `--yes` flag for non-TTY scripts and no `--dry-run` to preview what would be deleted.

## Evidence

```
Usage: poe-code memory clear [options]

Delete all memory content and re-initialize INDEX.md and LOG.md.

Options:
  -h, --help    Display help for command
```

Running `poe-code memory clear` in a CI script or by accident immediately destroys all memory without any confirmation prompt.

## Why it matters

Memory content is accumulated over time and may not be easily recoverable. Deleting it without confirmation is the highest-risk operation in the `memory` command group. Every other destructive command in the CLI (`auth logout`, `provider logout`) should also have this guard, but `memory clear` wipes potentially significant user work.

## Suggested direction

Require explicit confirmation: either prompt "Are you sure? (y/N)" in TTY mode, or require `--yes` in non-TTY/scripted contexts. Add `--dry-run` to preview what will be deleted.

## Severity

High

## Area

Memory / clear / safety / destructive

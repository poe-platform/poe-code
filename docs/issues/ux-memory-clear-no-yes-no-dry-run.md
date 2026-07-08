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

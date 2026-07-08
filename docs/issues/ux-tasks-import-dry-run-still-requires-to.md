# UX: tasks import --dry-run still requires --to

## Summary

tasks import --dry-run --from /tmp fails tasks import requires --to <workflow.md> — dry-run cannot preview without target path.

## Evidence

```bash
$ poe-code tasks import --dry-run --from /tmp
■  [error] tasks import requires --to <workflow.md>.
```

## Why it matters

Dry-run should list source files even without --to, or message should list all required flags.

## Suggested direction

Collect missing --from/--to together; allow dry-run of source scan without --to.

## Severity

Medium

## Area

Tasks

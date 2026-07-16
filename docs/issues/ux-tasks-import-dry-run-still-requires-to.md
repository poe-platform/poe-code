---
severity: medium
impact: usability
comment: "Reasonable, and its reasoning is the interesting part: a dry-run of an import should be able to show what it found in --from without knowing the destination, so requiring --to for a preview blocks the most useful half. Same one-error-at-a-time problem as the memory write and maestro tick filings - it also asks for missing flags to be collected together. Worth doing; the source scan is exactly what a user wants before committing a --delete-source run."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/tasks.ts:309 throws 'tasks import requires --to <workflow.md>.' unconditionally before any dryRun check; probe 'npm run dev -- tasks import --dry-run --from /tmp' printed that exact error"
---

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

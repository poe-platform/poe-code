# UX: gaslight ingest non-TTY demands POE_NO_PROMPT not --yes/--dry-run

## Summary

gaslight ingest --limit 1 --since 1d --dry-run still: Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 — global --dry-run and --yes not honored for agent selection.

## Evidence

```bash
$ poe-code gaslight ingest --limit 1 --since 1d --dry-run
■  Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 to accept defaults non-interactively.
```

## Why it matters

CI cannot dry-run ingest; POE_NO_PROMPT is obscure; --yes should accept defaults.

## Suggested direction

Honor --yes/--dry-run; require --agent non-TTY; UserError without POE_NO_PROMPT.

## Severity

**High**

## Area

Gaslight / non-TTY

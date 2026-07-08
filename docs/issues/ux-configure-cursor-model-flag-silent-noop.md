# UX: configure cursor --model is silent no-op in dry-run

## Summary

configure cursor --model anthropic/claude-opus-4.7 --yes --dry-run still only says would configure / no filesystem changes — explicit --model not reflected in dry-run output (extends cursor dry-run too quiet).

## Evidence

```bash
$ poe-code configure cursor --model anthropic/claude-opus-4.7 --yes --dry-run
●  Dry run: would configure Cursor.
●  # no filesystem changes
```

## Why it matters

Cannot verify model application for Cursor.

## Suggested direction

Print resolved model/provider/files even when no-op.

## Severity

Medium

## Area

Configure

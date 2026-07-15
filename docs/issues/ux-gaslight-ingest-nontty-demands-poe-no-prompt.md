---
severity: high
impact: usability
comment: "Duplicate of the non-TTY half of ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md; retire into it or into the shared non-TTY message issue (ux-configure-non-tty-demands-poe-no-prompt-not-yes.md). Its distinct observation should survive though: the global --dry-run is not honoured at all here, which is a stronger claim than 'the message names the wrong flag' - a global flag that silently does nothing is a correctness problem."
---

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

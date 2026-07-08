# UX: gaslight ingest has no --dry-run; failures dump JSONL; non-TTY POE_NO_PROMPT obscure

## Summary

gaslight ingest --dry-run is unknown (falls through to gaslight Interactive prompt requires TTY / POE_NO_PROMPT). Real ingest dumps JSONL on analysis failure and See logs. --yes not documented on ingest help.

## Evidence

```bash
$ poe-code gaslight ingest --limit 1 --since 1d --dry-run
■  Error: Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 …
$ poe-code gaslight ingest --limit 1 --since 1d --yes
◆  Analyzed 1 prompts from 192 traces…
■  Error: Gaslight ingest analysis failed: {"type":"system",…jsonl…}
```

## Why it matters

Ingest is high-cost; needs dry-run preview and clean failures; POE_NO_PROMPT is obscure vs --yes.

## Suggested direction

Add --dry-run (count traces/prompts only); --yes; UserError without JSONL dump.

## Severity

**High**

## Area

Gaslight

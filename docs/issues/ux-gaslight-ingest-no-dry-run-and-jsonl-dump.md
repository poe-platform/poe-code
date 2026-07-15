---
severity: high
impact: usability
comment: "Keep as canonical for the ingest problems (fullest transcript). Of the three asks it bundles, the missing --dry-run matters most because ingest is high-cost: users cannot preview how many traces/prompts would be analysed before paying for it. It also reveals something the title understates - --dry-run is not merely absent, it falls through to a TTY prompt error, so the global flag silently does not apply here. Split: (a) --dry-run support, (b) UserError instead of JSONL dump, (c) the non-TTY message, which duplicates its sibling."
---

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

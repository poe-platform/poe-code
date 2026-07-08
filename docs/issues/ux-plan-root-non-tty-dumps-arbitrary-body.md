# UX: plan (no subcommand) non-TTY dumps arbitrary plan body

## Summary

poe-code plan without question/subcommand in non-TTY dumps full body of some plan (same as browse) — not a list, not an error requiring TTY.

## Evidence

```bash
$ poe-code plan
# dumps toolcraft human-in-loop plan body
```

## Why it matters

Root plan command is ambiguous: browse vs draft vs list.

## Suggested direction

Non-TTY: print plan list or require question/subcommand; never dump arbitrary body.

## Severity

**High**

## Area

Plan / non-TTY

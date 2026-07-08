# UX: bare plan non-TTY dumps an arbitrary plan body

## Summary

plan with no args/subcommands in non-TTY dumps full body of some plan (Agent goal…) instead of list or fail-fast requiring browse/list/--yes.

## Evidence

```bash
$ poe-code plan
Agent goal — autonomous objective with budget & continuation
… full plan dump …
```

## Why it matters

Non-TTY bare plan is surprising; should list or require path.

## Suggested direction

Non-TTY: plan list or ValidationError: pass plan list|view|browse.

## Severity

**High**

## Area

Plan / non-TTY

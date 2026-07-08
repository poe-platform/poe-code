# UX: gaslight --yes without plan path stalls non-TTY

## Summary

gaslight --mode read --yes --model haiku without plan path stalled past 45s — non-TTY should require plan path or fail-fast.

## Evidence

```bash
$ poe-code gaslight --mode read --yes --model anthropic/claude-haiku-4.5
# hangs / stalls (probe timed out 45s)
```

## Why it matters

Non-TTY gaslight without plan is unusable.

## Suggested direction

Require plan path or --plans non-TTY; fail-fast ValidationError.

## Severity

**High**

## Area

Gaslight / non-TTY

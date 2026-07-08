# UX: pi-agent alias works (positive)

## Summary

spawn pi-agent resolves to pi and succeeds — positive alias behavior (title shows spawn pi).

## Evidence

```bash
$ poe-code spawn pi-agent "say only: ok" --mode read
┌   Poe - spawn pi
✓ agent: ok
```

## Why it matters

Positive alias; document pi-agent = pi in help.

## Suggested direction

Help note alias relationship.

## Severity

Low

## Area

Spawn / positive pattern

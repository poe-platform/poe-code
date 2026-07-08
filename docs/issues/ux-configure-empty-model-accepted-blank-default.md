# UX: configure --model "" accepted as blank default model

## Summary

configure claude --model "" --yes --dry-run shows blank default model and still plans full settings rewrite — empty model not rejected (empty flag class).

## Evidence

```bash
$ poe-code configure claude --model "" --yes --dry-run
◇  Claude Code default model
│     
# blank model; continues to plan full settings rewrite
```

## Why it matters

Empty model should ValidationError before any plan; related catalog validation Critical.

## Suggested direction

Reject empty --model. Model must not be empty.

## Severity

**High**

## Area

Configure

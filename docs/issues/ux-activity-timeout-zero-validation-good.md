# UX: --activity-timeout-ms 0/-1 validates cleanly (positive)

## Summary

Invalid activity timeout returns Expected a positive integer without stack.

## Evidence

```bash
$ poe-code spawn … --activity-timeout-ms 0
■  Invalid --activity-timeout-ms "0". Expected a positive integer.
```

## Why it matters

Positive validation pattern.

## Suggested direction

Keep; share with gaslight timeouts when added.

## Severity

Low

## Area

Spawn / positive pattern

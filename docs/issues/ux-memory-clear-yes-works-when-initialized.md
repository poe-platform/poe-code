# UX: memory clear --yes works when initialized (positive destructive)

## Summary

memory clear --yes after init succeeds with Cleared memory design-system framing; without init points to memory init.

## Evidence

```bash
$ poe-code memory clear --yes  # not init
■  Memory is not initialized…
$ poe-code memory init && poe-code memory clear --yes
◆  Cleared memory.
```

## Why it matters

Positive destructive guard with --yes (help still omits --yes).

## Suggested direction

Document --yes on help; keep behavior.

## Severity

Low

## Area

Memory / positive pattern

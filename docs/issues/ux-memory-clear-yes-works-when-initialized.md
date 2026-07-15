---
severity: low
impact: none
comment: "Duplicate of ux-memory-clear-yes-reinitializes-index-log.md; consolidate. Its extra evidence is worth keeping: clear --yes without init points to memory init rather than failing obscurely - the same good not-initialized pattern as ux-memory-ingest-not-init-good.md, consistent across the memory group and worth citing as a precedent."
---

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

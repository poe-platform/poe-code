# UX: memory INDEX still not showable after init (Critical reconfirm)

## Summary

memory init creates INDEX.md and LOG.md; memory ls: No memory pages yet; memory show INDEX and INDEX.md: Page not found — Critical INDEX path contract still broken end-to-end.

## Evidence

```bash
$ poe-code memory init
$ poe-code memory ls
No memory pages yet.
$ poe-code memory show INDEX
■  Page not found: INDEX.md
$ poe-code memory show INDEX.md
■  Page not found: INDEX.md
# files exist: .poe-code/memory/INDEX.md LOG.md
```

## Why it matters

Reconfirm Critical memory INDEX still open.

## Suggested direction

Map INDEX/LOG to root memory files; ls lists them.

## Severity

**High**

## Area

Memory

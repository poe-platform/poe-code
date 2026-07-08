# UX: memory show INDEX.md still not found after init (critical reconfirm)

## Summary

memory init creates .poe-code/memory/INDEX.md and LOG.md, but memory show INDEX, INDEX.md, and .poe-code/memory/INDEX.md all return Page not found; memory ls says No memory pages yet. Root index path contract is broken end-to-end.

## Evidence

```bash
$ poe-code memory init
◆  Initialized memory at .poe-code/memory
# files exist: .poe-code/memory/INDEX.md, LOG.md
$ poe-code memory show INDEX
■  Page not found: INDEX.md
$ poe-code memory show INDEX.md
■  Page not found: INDEX.md
$ poe-code memory show .poe-code/memory/INDEX.md
■  Page not found: .poe-code/memory/INDEX.md
$ poe-code memory ls
No memory pages yet.
```
cat INDEX.md works outside CLI.

## Why it matters

Reconfirm Critical memory INDEX/LOG path contract: init creates files users cannot show or list.

## Suggested direction

Map INDEX / INDEX.md / LOG.md to root memory files; ls should list INDEX and LOG.

## Severity

**High**

## Area

Memory

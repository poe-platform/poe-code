---
severity: high
impact: correctness
reproduced: y
recommendation: fix
evidence: "src/cli/commands/memory.ts:48 forces every show/ls path under pages/ (resolvePageRelPath), and packages/memory/src/pages.ts:15 listPages only scans MEMORY_PAGES_DIR_RELPATH, while packages/memory/src/init.ts:17-26 writes INDEX.md and LOG.md at the memory root - so root files are unreachable: show INDEX resolves to pages/INDEX.md and reports 'Page not found: INDEX.md'."
comment: "Strong filing and the clearest statement of the Critical memory contract break: init creates INDEX.md and LOG.md, then ls reports 'No memory pages yet' and show INDEX / show INDEX.md both answer 'Page not found' while the files demonstrably exist on disk. The product denies the existence of what it just created - the same shape as ux-harness-list-only-cwd-not-created-dir.md but worse, because these are the files the whole memory model is built on. Its diagnosis is likely right: the page namespace excludes the root files. Corroborated incidentally by ux-memory-clear-yes-reinitializes-index-log.md."
---

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

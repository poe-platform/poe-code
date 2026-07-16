---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/memory.ts:48 forces every show path under pages/ (INDEX -> pages/INDEX.md) while packages/memory/src/init.ts:17-26 writes INDEX.md/LOG.md at the memory root; packages/memory/src/pages.ts:15 lists only MEMORY_PAGES_DIR_RELPATH, so ls prints 'No memory pages yet'. displayPageRelPath (memory.ts:56) strips the pages/ prefix, reproducing the exact reported 'Page not found: INDEX.md' text. Duplicate of ux-memory-show-cannot-open-root-index-file.md."
comment: "The most thorough of the INDEX reconfirms - it tries INDEX, INDEX.md and the full .poe-code/memory/INDEX.md path, all failing, and confirms cat works outside the CLI. That triangulation is the evidence the canonical should carry, since it rules out a path-format mistake by the user. Retire into ux-memory-show-cannot-open-root-index-file.md; rated High against that Critical for identical behavior, so normalise."
---

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

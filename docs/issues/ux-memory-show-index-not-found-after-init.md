---
severity: high
impact: correctness
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/memory.ts:48 resolvePageRelPath forces show paths under pages/ so 'show INDEX.md' becomes pages/INDEX.md and throws 'Page not found: INDEX.md' (memory.ts:253), while packages/memory/src/init.ts:17-26 writes INDEX.md/LOG.md at the memory root and packages/memory/src/pages.ts:15 listPages scans only MEMORY_PAGES_DIR_RELPATH; duplicate of ux-memory-show-cannot-open-root-index-file.md"
comment: "Duplicate within the INDEX cluster; retire into ux-memory-show-cannot-open-root-index-file.md. No distinct evidence beyond the other reconfirms."
---

# UX: memory show INDEX.md not found right after init

## Summary

memory init succeeds; memory show INDEX.md → Page not found: INDEX.md — init claims INDEX.md/LOG.md but show cannot open INDEX.md by that path.

## Evidence

```bash
$ poe-code memory init
◆  Initialized memory at .poe-code/memory
$ poe-code memory show INDEX.md
■  Page not found: INDEX.md
$ poe-code memory ls
No memory pages yet.
```

## Why it matters

Init/list/show path contract broken; empty memory has no pages including INDEX.

## Suggested direction

Either list INDEX/LOG after init or fix show paths; document page path form.

## Severity

**High**

## Area

Memory

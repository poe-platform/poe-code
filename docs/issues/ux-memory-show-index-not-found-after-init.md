---
severity: high
impact: crash
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

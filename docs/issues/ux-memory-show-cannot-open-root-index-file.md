# UX: memory show cannot open root INDEX.md (path contract broken)

## Summary

memory init creates .poe-code/memory/INDEX.md and LOG.md on disk, but memory show INDEX.md and absolute path both fail Page not found; memory ls says No memory pages yet — only pages/ subtree is addressable.

## Evidence

```bash
$ ls .poe-code/memory
INDEX.md LOG.md pages/
$ poe-code memory show INDEX.md
■  Page not found: INDEX.md
$ poe-code memory ls
No memory pages yet.
```

## Why it matters

Core memory files created by init are invisible to show/ls — product broken for first-run memory.

## Suggested direction

Include INDEX/LOG in ls/show; or document pages-only and stop claiming INDEX in init help.

## Severity

**Critical**

## Area

Memory

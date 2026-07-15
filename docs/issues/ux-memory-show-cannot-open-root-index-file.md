---
severity: critical
impact: crash
comment: "Keep as canonical of the four-file INDEX cluster and correctly Critical: init creates .poe-code/memory/INDEX.md and LOG.md and neither show nor ls can address them, so only the pages/ subtree is reachable. Its framing is the sharpest of the four because it names the actual contract question rather than the symptom - either INDEX/LOG are pages and must be listable, or they are not and init should stop advertising them. That is the decision the fix needs. Absorbs the three reconfirms."
---

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

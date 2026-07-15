---
severity: medium
impact: polish
comment: "Duplicate within the memory write bare-output cluster; retire into ux-memory-ls-search-show-raw-unframed.md. Its evidence is the most detailed of the four - the write echoes the path, the frontmatter, the body and a path:line snippet, which is more dump than success line - and its suggested card (path, reason, bytes) is the best-specified fix in the cluster."
---

# UX: memory write success output is raw unframed text

## Summary

After memory write, stdout dumps frontmatter/body and path:line snippets without design-system success panel used by memory init.

## Evidence

```bash
$ echo note | poe-code memory write pages/note.md --reason "ux audit test"
note.md
---
last_touched_at: …
---
note
note.md:4: note
```
memory init uses ◆ Initialized… panel; write does not.

## Why it matters

Inconsistent success language inside memory group.

## Suggested direction

Design-system success card: wrote path, reason, bytes; --json for raw.

## Severity

Medium

## Area

Memory

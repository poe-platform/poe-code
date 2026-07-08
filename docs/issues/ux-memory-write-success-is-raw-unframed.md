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

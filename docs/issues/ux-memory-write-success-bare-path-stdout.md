# UX: memory write success is bare path on stdout

## Summary

memory write pages/hello.md --reason test succeeds then show works; write success appears as bare path "hello.md" without design-system framing (related bare success patterns).

## Evidence

```bash
$ echo hello | poe-code memory write pages/hello.md --reason test
hello.md
$ poe-code memory show pages/hello.md
---
last_touched_at: …
---
hello memory
```

## Why it matters

Inconsistent success framing; INDEX still broken for show while user pages work.

## Suggested direction

Design-system success for TTY; bare path optional --output json.

## Severity

Low–Medium

## Area

Memory

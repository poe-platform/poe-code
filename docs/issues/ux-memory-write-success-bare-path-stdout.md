---
severity: low-medium
impact: polish
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/memory.ts:298 write action calls mem.writePage then returns; no stdout write, so success is silent, not a bare path. No stdout/console output in packages/memory/src/write.ts, handle.ts, pages.ts, index.ts."
comment: "Duplicate within the memory write bare-output cluster; retire into ux-memory-ls-search-show-raw-unframed.md. Its incidental evidence is useful though: write then show pages/hello.md works end to end, corroborating ux-memory-user-page-show-works-index-does-not.md that the pages path is sound and only INDEX is broken."
---

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

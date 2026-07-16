---
severity: low-medium
impact: polish
comment: "Duplicate in substance of ux-memory-ls-search-show-raw-unframed.md (unframed memory output); consolidate. Its distinct and worthwhile point is the ratio line: 'Tokens: memory=2, sources=0, ratio=0.00x' exposes a metric with no explanation - the same unexplained-internals problem as --budget, where the memory group surfaces LLM plumbing without glossing it."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/memory.ts:482-497 memory status uses raw process.stdout.write for Pages/Bytes/Last write and 'Tokens: memory=..., sources=..., ratio=...' with no design-system framing and no gloss on ratio; toolcraft-design is imported only for confirmOrCancel (line 6)"
---

# UX: memory status is a terse multi-line dump

## Summary

memory status prints Pages/Bytes/Last write/Tokens as bare lines without panel framing or interpretation (healthy vs empty).

## Evidence

```text
Pages: 1
Bytes: 168
Last write: …
Tokens: memory=2, sources=0, ratio=0.00×
```

## Why it matters

Status commands should be scannable cards; ratio meaning opaque.

## Suggested direction

Design-system status card; explain ratio; link memory ls/search.

## Severity

Low–Medium

## Area

Memory

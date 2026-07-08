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

# UX: traces --json includes full multi-line prompt titles (PII/noise)

## Summary

traces --json dumps title fields that can be entire memory-query prompts or long user messages — useful for debugging but floods and may include sensitive prompt content when listed.

## Evidence

```json
"title": "Answer using only the provided memory pages.… Question: what is note … FILE: pages/note.md …"
```

## Why it matters

JSON list mode may leak prompt content into scripts/logs.

## Suggested direction

Truncate titles by default; --full-titles for complete; document.

## Severity

Medium–High

## Area

Traces / privacy

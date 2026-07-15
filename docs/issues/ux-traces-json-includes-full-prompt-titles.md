---
severity: medium-high
impact: security
comment: "Legitimate privacy concern and better evidenced than most: traces --json emits title fields containing entire prompts, so a list operation exports user content into scripts and logs. Same class as the --log-content warning but worse in one respect - there is no opt-in here, listing traces is the default path. Its fix is right: truncate by default, --full-titles to opt in. Worth checking whether the human table truncates already, which would make this a JSON-only leak."
---

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

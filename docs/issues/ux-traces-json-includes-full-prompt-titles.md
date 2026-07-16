---
severity: medium-high
impact: usability
reproduced: y
recommendation: fix
evidence: "run.ts:103 writes JSON.stringify(references) with untruncated titles, while render.ts:126 truncates labels to MAX_TRACE_LABEL_WIDTH=60 and run.ts renderTraceReferenceTable caps title maxLen 30; claude.ts:643 sets title from the first human message text with no length cap, so JSON emits whole prompts. No --full-titles flag exists in src/cli/commands/traces.ts."
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

---
severity: low
impact: none
comment: "The most valuable positive in the logging set: it proves the default redacts agent_message to '[redacted]', so the privacy default is correct and --log-content is an informed opt-out rather than a leak. That fact caps the severity of the whole --log-content warning cluster - the gap is a missing warning, not exposure. Keep and link there; its 'warn once when --log-content set' suggestion is the right fix."
---

# UX: spawn default JSONL log redacts agent_message (positive)

## Summary

Default ACP JSONL log writes agent_message text as [redacted] — good privacy default. --log-content includes fuller agent text; help underwarns sensitivity (related existing issue).

## Evidence

```json
{"event":"agent_message","text":"[redacted]",…}
```
with --log-content: full agent prose appears in log file.

## Why it matters

Positive default; document --log-content risk more strongly.

## Suggested direction

Keep default redact; warn once when --log-content set.

## Severity

Low

## Area

Spawn / positive pattern

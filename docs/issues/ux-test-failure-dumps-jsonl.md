---
severity: high
impact: usability
comment: "Real and worth High: a health check exists to answer one question and it answers with a JSONL flood plus a log pointer, so the command's entire purpose is defeated on the path that matters most - failure. Its fix is right (short summary, stream behind --verbose). Same shape as ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md, so one decision covers both: machine streams are opt-in, humans get a verdict."
---

# UX: Failed test dumps raw agent JSONL

## Summary

test failure inlines hook JSONL flood.

## Evidence

test --yes → JSONL + See logs.

## Why it matters

Health-check unreadable.

## Suggested direction

Short summary; verbose for stream.

## Severity

**High**

## Area

Test / errors

---
severity: high
impact: usability
comment: "Duplicate of the ingest half of ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md, which carries the actual transcript; retire into it. The point stands: after reporting 'Analyzed N prompts' as success, dumping raw JSONL as the failure is the worst of both - it looks like it worked, then emits machine noise the user cannot act on."
---

# UX: gaslight ingest failures dump JSONL

## Summary

Ingest analysis failure JSONL after Analyzed N prompts.

## Evidence

gaslight ingest --yes.

## Why it matters

Heavy command needs scannable failure.

## Suggested direction

Human summary; no success framing on fail.

## Severity

**High**

## Area

Gaslight

---
severity: high
impact: usability
comment: "Duplicate of the ingest half of ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md, which carries the actual transcript; retire into it. The point stands: after reporting 'Analyzed N prompts' as success, dumping raw JSONL as the failure is the worst of both - it looks like it worked, then emits machine noise the user cannot act on."
reproduced: y
recommendation: no-fix
evidence: "packages/agent-gaslight/src/ingest.ts:634-635 throws with raw result.stdout (JSONL) as message; src/cli/commands/gaslight.ts:417-418 spinner stopMessage prints 'Analyzed N prompts' first because spawn resolves on non-zero exit. Duplicate of ux-gaslight-ingest-no-dry-run-and-jsonl-dump.md."
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

---
severity: high
impact: correctness
reproduced: y
recommendation: fix
evidence: "query.ts:136 and explain.ts:90-91 build prose prompts (no JSON contract), but query.ts:40 and explain.ts:52 pass stdout to parseMemoryAgentResponse, which throws 'Memory agent returned invalid JSON output.' at agent-response.ts:12; spawn() is called without a model and stderr is discarded."
comment: "Keep as canonical of this pair (covers explain and query). Real and well diagnosed: 'Memory agent returned invalid JSON output' plus 'See logs' gives users nothing - no agent stderr, no model, no retry path - and its hypothesis is plausible and testable, that the memory agent path uses the dead default model (the sonnet-5 cluster). Verify that first: if so this closes with the constants fix and only the error copy remains. Absorbs ux-memory-explain-invalid-json-system-chrome.md."
---

# UX: memory explain/query fail with opaque "invalid JSON output"

## Summary

memory explain and memory query fail with Memory agent returned invalid JSON output + See logs — no agent stderr, model used, or recovery (configure model / retry). Likely stale default model in agent path.

## Evidence

```bash
$ poe-code memory explain pages/note.md
■  Error: Memory agent returned invalid JSON output.
●  See logs …
$ poe-code memory query "what is note"
■  Error: Memory agent returned invalid JSON output.
```

## Why it matters

Users cannot debug agent-backed memory features.

## Suggested direction

Surface agent error/model; validate model; UserError with configure hint.

## Severity

**High**

## Area

Memory

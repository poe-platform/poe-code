---
severity: medium
impact: polish
reproduced: y
recommendation: fix
evidence: "packages/toolcraft-design/src/acp/components.ts:32 agentPrefix returns green bold checkmark for agent text; :108 renderReasoning and :145 renderUsage also prefix content with checkmark"
comment: "The cleanest statement of the glyph-semantics problem: check-marks prefix the agent's narrative lines, so the mark means 'here is some text' rather than 'this succeeded' - which is precisely why it can appear on an API error (ux-spawn-invalid-model-shows-success-then-failure.md). Its diagnosis identifies the root the failure-glyph filings only see the symptom of: content lines are rendered with a status glyph. Fix here and the whole family resolves. Consolidate with ux-acp-stream-uses-success-glyph-for-partial-text.md."
---

# UX: Successful spawn still uses ✓ for agent narrative text

## Summary

Even successful spawn pi output prefixes agent thinking/answer lines with ✓, same glyph as success status — consistent with ACP stream glyph issue.

## Evidence

```text
  ✓ The user wants me to say only "ok".
✓ agent: ok
✓ tokens: …
```

## Why it matters

Status language remains muddled even when the run succeeds.

## Suggested direction

Neutral bullets for content; ✓ only for completed success steps.

## Severity

Medium

## Area

Visual language

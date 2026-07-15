---
severity: low
impact: none
comment: "Positive pattern, no code change. Duplicate of ux-agent-default-model-works-when-opus-valid.md, which has stronger evidence (live run plus constants). Consolidate into that one. Note the direct contradiction with ux-agent-default-opus-4-7-not-latest-opus-4-8.md and ux-agent-default-model-hardcoded.md, which call the same 4.7 default stale: reconcile to one position - 4.7 is live and works but lags 4.8."
---

# UX: agent default model is anthropic/claude-opus-4.7 (positive)

## Summary

agent --help default model anthropic/claude-opus-4.7 (live frontier); agent "say only: ping" works.

## Evidence

--model <model> (default: anthropic/claude-opus-4.7)
agent → ping success

## Why it matters

Positive contrast to configure claude dead sonnet-5 default.

## Suggested direction

Keep agent default; align configure defaults similarly.

## Severity

Low

## Area

Agent / positive pattern
